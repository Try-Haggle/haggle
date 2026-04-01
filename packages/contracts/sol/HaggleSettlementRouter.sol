// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title HaggleSettlementRouter
/// @notice Non-custodial settlement router for Haggle P2P trades on Base L2.
///         Routes ERC-20 (USDC) from buyer → seller + fee wallet in a single atomic tx.
///         Never holds user funds — all transfers are immediate.
/// @dev Security model:
///      1. Caller must be the buyer (msg.sender == params.buyer).
///      2. Backend signs settlement params via EIP-712 — prevents parameter manipulation.
///      3. Each orderId can only be settled once.
///      4. Only allowlisted assets are accepted.
///      5. Signatures include a deadline and signerNonce to prevent stale/rotated replays.
///      6. On-chain fee cap (MAX_FEE_BPS) limits blast radius of compromised signer.
///      7. Two-phase signer rotation with 48-hour delay (governance-safe).
///      8. EIP-1271 support for smart contract signers (multisig).
///      9. Guardian role for fast emergency pause (separate from owner multisig).
contract HaggleSettlementRouter is Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────
    /// @notice Maximum fee in basis points (10% = 1000 bps). Limits compromised-signer blast radius.
    uint256 public constant MAX_FEE_BPS = 1000;

    /// @notice Minimum gross amount to prevent dust-spam attacks (0.01 USDC with 6 decimals).
    uint256 public constant MIN_GROSS_AMOUNT = 1e4;

    /// @notice Time delay before a proposed signer rotation can be confirmed. CLAUDE.md: 48h+ Timelock.
    uint256 public constant SIGNER_ROTATION_DELAY = 48 hours;

    // ─── Types ───────────────────────────────────────────────

    /// @notice Settlement parameters passed by the buyer.
    struct SettlementParams {
        bytes32 orderId;
        bytes32 paymentIntentId;
        address buyer;
        address seller;
        address sellerWallet;
        address feeWallet;
        address asset;
        uint256 grossAmount;
        uint256 sellerAmount;
        uint256 feeAmount;
        uint256 deadline;
        uint256 signerNonce;
    }

    // ─── Errors ──────────────────────────────────────────────
    error AmountMismatch();
    error ZeroAddress();
    error CallerNotBuyer();
    error OrderAlreadySettled();
    error AssetNotAllowed();
    error InvalidSignature();
    error SignerNotSet();
    error DeadlineExpired();
    error FeeTooHigh();
    error AmountTooLow();
    error AmountTooHigh();
    error RecipientIsRouter();
    error NotGuardianOrOwner();
    error NoSignerProposed();
    error RotationTooEarly();
    error SignerNonceMismatch();
    error SignerMismatch();
    error PauseCooldownActive();
    error BuyerIsSeller();
    error FeeWalletEqualsSeller();
    error OrderNotSettled();
    error OrderVoided();

    // ─── Events ──────────────────────────────────────────────
    event SettlementExecuted(
        bytes32 indexed executionId,
        bytes32 indexed orderId,
        bytes32 paymentIntentId,
        address buyer,
        address seller,
        address sellerWallet,
        address feeWallet,
        address asset,
        uint256 grossAmount,
        uint256 sellerAmount,
        uint256 feeAmount
    );

    event AssetAllowed(address indexed asset);
    event AssetDisallowed(address indexed asset);
    event SignerUpdated(address indexed oldSigner, address indexed newSigner);
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    event MaxSettlementAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event SignerRotationProposed(address indexed proposedSigner, uint256 readyAt);
    event SignerRotationCancelled(address indexed cancelledSigner);
    event OrderReset(bytes32 indexed orderId);
    event OrderVoidedEvent(bytes32 indexed orderId, string reason);

    // ─── EIP-712 ─────────────────────────────────────────────
    bytes32 public constant SETTLEMENT_TYPEHASH = keccak256(
        "Settlement(bytes32 orderId,bytes32 paymentIntentId,address buyer,address seller,"
        "address sellerWallet,address feeWallet,address asset,uint256 grossAmount,"
        "uint256 sellerAmount,uint256 feeAmount,uint256 deadline,uint256 signerNonce)"
    );

    // ─── State ───────────────────────────────────────────────
    mapping(bytes32 => bool) public settledOrders;
    mapping(bytes32 => bool) public voidedOrders;
    mapping(address => bool) public allowedAssets;
    address public signer;
    uint256 public signerNonce;

    /// @notice Guardian can emergency-pause without multisig delay. Cannot unpause.
    address public guardian;

    /// @notice Per-tx settlement cap. 0 = no cap.
    uint256 public maxSettlementAmount;

    /// @notice Two-phase signer rotation state.
    address public pendingSigner;
    uint256 public signerRotationReadyAt;

    /// @notice Guardian pause cooldown to prevent griefing.
    uint256 public lastPausedAt;
    uint256 public constant PAUSE_COOLDOWN = 1 hours;

    // ─── Constructor ─────────────────────────────────────────
    constructor(
        address initialOwner,
        address initialSigner
    ) Ownable(initialOwner) EIP712("HaggleSettlementRouter", "1") {
        if (initialSigner == address(0)) revert ZeroAddress();
        signer = initialSigner;
        emit SignerUpdated(address(0), initialSigner);
    }

    // ─── Disable renounceOwnership ───────────────────────────
    /// @notice Disabled to prevent accidental permanent lock.
    function renounceOwnership() public pure override {
        revert("disabled");
    }

    /// @notice Auto-cancel pending signer rotation when ownership is transferred.
    function _transferOwnership(address newOwner) internal override {
        if (pendingSigner != address(0)) {
            emit SignerRotationCancelled(pendingSigner);
            pendingSigner = address(0);
            signerRotationReadyAt = 0;
        }
        super._transferOwnership(newOwner);
    }

    // ─── Core ────────────────────────────────────────────────

    /// @notice Execute a settlement: transfer ERC-20 from buyer to seller + fee wallet.
    /// @dev Caller MUST be the buyer. Backend must sign params via EIP-712.
    ///      Each orderId can only be settled once. Asset must be allowlisted.
    /// @param p Settlement parameters struct (includes deadline and signerNonce).
    /// @param signature EIP-712 signature from the authorized signer (EOA or EIP-1271 contract).
    /// @return executionId Unique deterministic identifier for this settlement.
    function executeSettlement(
        SettlementParams calldata p,
        bytes calldata signature
    ) external whenNotPaused nonReentrant returns (bytes32 executionId) {
        // ── Caller & Replay ──
        if (msg.sender != p.buyer) revert CallerNotBuyer();
        if (block.timestamp > p.deadline) revert DeadlineExpired();
        if (p.signerNonce != signerNonce) revert SignerNonceMismatch();
        if (settledOrders[p.orderId]) revert OrderAlreadySettled();
        if (voidedOrders[p.orderId]) revert OrderVoided();

        // ── Address validation ──
        if (p.buyer == address(0) || p.seller == address(0) || p.sellerWallet == address(0) || p.asset == address(0)) {
            revert ZeroAddress();
        }
        if (p.buyer == p.seller) revert BuyerIsSeller();
        if (p.sellerWallet == address(this)) revert RecipientIsRouter();
        if (p.feeAmount > 0) {
            if (p.feeWallet == address(0)) revert ZeroAddress();
            if (p.feeWallet == address(this)) revert RecipientIsRouter();
            if (p.feeWallet == p.sellerWallet) revert FeeWalletEqualsSeller();
        }

        // ── Amount validation ──
        if (p.grossAmount < MIN_GROSS_AMOUNT) revert AmountTooLow();
        if (maxSettlementAmount > 0 && p.grossAmount > maxSettlementAmount) revert AmountTooHigh();
        if (p.sellerAmount + p.feeAmount != p.grossAmount) revert AmountMismatch();

        // ── Fee cap: feeAmount ≤ grossAmount × MAX_FEE_BPS / 10000 ──
        if (p.feeAmount * 10000 > p.grossAmount * MAX_FEE_BPS) revert FeeTooHigh();

        // ── Asset allowlist ──
        if (!allowedAssets[p.asset]) revert AssetNotAllowed();

        // ── Deterministic execution ID ──
        executionId = keccak256(abi.encode(p.orderId, p.paymentIntentId, block.chainid));

        // ── Mark settled BEFORE signature verification (strict CEI) ──
        // _verifySigner may perform external call via EIP-1271 isValidSignature.
        // Setting state before external call prevents cross-contract reentrancy.
        settledOrders[p.orderId] = true;

        // ── Verify EIP-712 signature (supports EOA + EIP-1271 smart contract signers) ──
        _verifySigner(p, signature);

        // ── Transfers ──
        IERC20(p.asset).safeTransferFrom(p.buyer, p.sellerWallet, p.sellerAmount);
        if (p.feeAmount > 0) {
            IERC20(p.asset).safeTransferFrom(p.buyer, p.feeWallet, p.feeAmount);
        }

        emit SettlementExecuted(
            executionId, p.orderId, p.paymentIntentId,
            p.buyer, p.seller, p.sellerWallet, p.feeWallet, p.asset,
            p.grossAmount, p.sellerAmount, p.feeAmount
        );
    }

    // ─── Internal ────────────────────────────────────────────

    function _verifySigner(SettlementParams calldata p, bytes calldata signature) internal view {
        if (signer == address(0)) revert SignerNotSet();
        bytes32 structHash = keccak256(abi.encode(
            SETTLEMENT_TYPEHASH,
            p.orderId, p.paymentIntentId, p.buyer, p.seller, p.sellerWallet,
            p.feeWallet, p.asset, p.grossAmount, p.sellerAmount, p.feeAmount,
            p.deadline, p.signerNonce
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        if (!SignatureChecker.isValidSignatureNow(signer, digest, signature)) {
            revert InvalidSignature();
        }
    }

    // ─── Admin: Signer Rotation (Two-Phase, 48h Delay) ──────

    /// @notice Propose a new signer. Takes effect after SIGNER_ROTATION_DELAY.
    ///         If a previous proposal exists, it is implicitly cancelled.
    /// @param newSigner Address of the proposed new signer.
    function proposeSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        if (pendingSigner != address(0)) {
            emit SignerRotationCancelled(pendingSigner);
        }
        pendingSigner = newSigner;
        signerRotationReadyAt = block.timestamp + SIGNER_ROTATION_DELAY;
        emit SignerRotationProposed(newSigner, signerRotationReadyAt);
    }

    /// @notice Confirm the pending signer rotation after the delay.
    ///         Increments signerNonce to invalidate all outstanding signatures.
    /// @param expectedSigner Address caller expects to confirm (double-check guard against social engineering).
    function confirmSigner(address expectedSigner) external onlyOwner {
        if (pendingSigner == address(0)) revert NoSignerProposed();
        if (pendingSigner != expectedSigner) revert SignerMismatch();
        if (block.timestamp < signerRotationReadyAt) revert RotationTooEarly();

        address oldSigner = signer;
        signer = pendingSigner;
        signerNonce++;
        pendingSigner = address(0);
        signerRotationReadyAt = 0;
        emit SignerUpdated(oldSigner, signer);
    }

    /// @notice Cancel a pending signer rotation.
    function cancelSignerRotation() external onlyOwner {
        address cancelled = pendingSigner;
        pendingSigner = address(0);
        signerRotationReadyAt = 0;
        if (cancelled != address(0)) {
            emit SignerRotationCancelled(cancelled);
        }
    }

    /// @notice Emergency: freeze signer immediately to stop compromised key.
    /// @dev Bricks all settlements until a new signer is confirmed via two-phase rotation.
    function emergencyFreezeSigner() external onlyOwner {
        address frozen = signer;
        signer = address(0);
        signerNonce++;
        if (pendingSigner != address(0)) {
            emit SignerRotationCancelled(pendingSigner);
            pendingSigner = address(0);
            signerRotationReadyAt = 0;
        }
        emit SignerUpdated(frozen, address(0));
    }

    // ─── Admin: Guardian ─────────────────────────────────────

    /// @notice Set or remove the guardian. Guardian can emergency-pause only.
    /// @param newGuardian New guardian address. address(0) to remove.
    function setGuardian(address newGuardian) external onlyOwner {
        address oldGuardian = guardian;
        guardian = newGuardian;
        emit GuardianUpdated(oldGuardian, newGuardian);
    }

    // ─── Admin: Settlement Cap ───────────────────────────────

    /// @notice Set the per-transaction settlement amount cap. 0 = no cap.
    /// @param newAmount Maximum gross amount per settlement.
    function setMaxSettlementAmount(uint256 newAmount) external onlyOwner {
        uint256 oldAmount = maxSettlementAmount;
        maxSettlementAmount = newAmount;
        emit MaxSettlementAmountUpdated(oldAmount, newAmount);
    }

    // ─── Admin: Asset Allowlist ──────────────────────────────

    /// @notice Add an asset to the allowlist (e.g. USDC).
    /// @param asset ERC-20 token address to allow.
    function allowAsset(address asset) external onlyOwner {
        if (asset == address(0)) revert ZeroAddress();
        allowedAssets[asset] = true;
        emit AssetAllowed(asset);
    }

    /// @notice Remove an asset from the allowlist.
    /// @param asset ERC-20 token address to disallow.
    function disallowAsset(address asset) external onlyOwner {
        if (asset == address(0)) revert ZeroAddress();
        allowedAssets[asset] = false;
        emit AssetDisallowed(asset);
    }

    // ─── Admin: Manual Override ──────────────────────────────

    /// @notice Reset a settled order so it can be re-settled with correct parameters.
    /// @dev Use when settlement executed with wrong params (e.g. wrong sellerWallet).
    ///      Does NOT reverse token transfers — off-chain reconciliation required.
    /// @param orderId The order to reset.
    function adminResetOrder(bytes32 orderId) external onlyOwner {
        if (!settledOrders[orderId]) revert OrderNotSettled();
        settledOrders[orderId] = false;
        emit OrderReset(orderId);
    }

    /// @notice Permanently void an order. Voided orders can never be settled.
    /// @dev Use when fraud is detected or order must be permanently blocked.
    /// @param orderId The order to void.
    /// @param reason Human-readable reason for audit trail.
    function adminVoidOrder(bytes32 orderId, string calldata reason) external onlyOwner {
        voidedOrders[orderId] = true;
        settledOrders[orderId] = false;
        emit OrderVoidedEvent(orderId, reason);
    }

    // ─── Admin: Pause ────────────────────────────────────────

    /// @notice Pause all settlements. Callable by owner OR guardian for fast emergency response.
    ///         Guardian has a cooldown to prevent pause-griefing; owner has no cooldown.
    function pause() external {
        if (msg.sender != owner() && msg.sender != guardian) revert NotGuardianOrOwner();
        if (msg.sender == guardian && lastPausedAt != 0 && block.timestamp < lastPausedAt + PAUSE_COOLDOWN) {
            revert PauseCooldownActive();
        }
        lastPausedAt = block.timestamp;
        _pause();
    }

    /// @notice Resume settlements after pause. Owner only (guardian cannot unilaterally resume).
    function unpause() external onlyOwner {
        _unpause();
    }
}
