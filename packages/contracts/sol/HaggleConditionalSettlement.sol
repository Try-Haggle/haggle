// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title HaggleConditionalSettlement
/// @notice Rules-limited settlement contract for buyer-approved Haggle payments.
/// @dev The contract holds only funded order amounts and releases/refunds them by
///      policy-bound signatures or buyer-protective expiry. Haggle admin cannot
///      arbitrarily move funds.
contract HaggleConditionalSettlement is Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_FEE_BPS = 1000;
    uint256 public constant MIN_GROSS_AMOUNT = 1e4;

    enum SettlementState {
        NONE,
        FUNDED,
        RELEASED,
        REFUNDED,
        DISPUTED
    }

    struct ConditionalSettlementParams {
        bytes32 orderId;
        bytes32 paymentIntentId;
        bytes32 approvalPolicyHash;
        bytes32 agreementHash;
        bytes32 listingHash;
        bytes32 grantNonce;
        address buyer;
        address seller;
        address asset;
        uint256 grossAmount;
        uint256 expiresAt;
        uint256 signerNonce;
    }

    struct ReleaseParams {
        bytes32 settlementId;
        address sellerWallet;
        address feeWallet;
        uint256 sellerAmount;
        uint256 feeAmount;
        uint256 deadline;
        uint256 signerNonce;
    }

    struct RefundParams {
        bytes32 settlementId;
        uint256 deadline;
        uint256 signerNonce;
    }

    struct SettlementRecord {
        SettlementState state;
        bytes32 orderId;
        bytes32 paymentIntentId;
        bytes32 approvalPolicyHash;
        bytes32 agreementHash;
        bytes32 listingHash;
        bytes32 grantNonce;
        address buyer;
        address seller;
        address asset;
        uint256 grossAmount;
        uint256 expiresAt;
        bytes32 disputeEvidenceHash;
    }

    error ZeroAddress();
    error CallerNotBuyer();
    error CallerNotParticipant();
    error AssetNotAllowed();
    error InvalidSignature();
    error SignerNotSet();
    error DeadlineExpired();
    error SettlementAlreadyExists();
    error SettlementNotFunded();
    error SettlementFinalized();
    error SettlementNotExpired();
    error AmountTooLow();
    error AmountMismatch();
    error FeeTooHigh();
    error BuyerIsSeller();
    error RecipientIsContract();
    error SignerNonceMismatch();
    error SellerWalletMismatch();
    error SettlementInDispute();
    error SettlementAlreadyDisputed();

    event SettlementFunded(
        bytes32 indexed settlementId,
        bytes32 indexed orderId,
        bytes32 paymentIntentId,
        bytes32 approvalPolicyHash,
        address buyer,
        address seller,
        address asset,
        uint256 grossAmount,
        uint256 expiresAt
    );
    event SettlementReleased(
        bytes32 indexed settlementId,
        address sellerWallet,
        address feeWallet,
        uint256 sellerAmount,
        uint256 feeAmount
    );
    event SettlementRefunded(bytes32 indexed settlementId, address buyer, uint256 amount);
    event SettlementDisputed(bytes32 indexed settlementId, bytes32 evidenceHash);
    event AssetAllowed(address indexed asset);
    event AssetDisallowed(address indexed asset);
    event SignerUpdated(address indexed oldSigner, address indexed newSigner);

    bytes32 public constant CONDITIONAL_SETTLEMENT_TYPEHASH = keccak256(
        "ConditionalSettlement(bytes32 orderId,bytes32 paymentIntentId,bytes32 approvalPolicyHash,"
        "bytes32 agreementHash,bytes32 listingHash,bytes32 grantNonce,address buyer,address seller,"
        "address asset,uint256 grossAmount,uint256 expiresAt,uint256 signerNonce)"
    );

    bytes32 public constant RELEASE_TYPEHASH = keccak256(
        "Release(bytes32 settlementId,address sellerWallet,address feeWallet,uint256 sellerAmount,"
        "uint256 feeAmount,uint256 deadline,uint256 signerNonce)"
    );

    bytes32 public constant REFUND_TYPEHASH = keccak256(
        "Refund(bytes32 settlementId,uint256 deadline,uint256 signerNonce)"
    );

    mapping(bytes32 => SettlementRecord) private _settlements;
    mapping(address => bool) public allowedAssets;
    address public signer;
    uint256 public signerNonce;

    constructor(address initialOwner, address initialSigner)
        Ownable(initialOwner)
        EIP712("HaggleConditionalSettlement", "1")
    {
        if (initialSigner == address(0)) revert ZeroAddress();
        signer = initialSigner;
        emit SignerUpdated(address(0), initialSigner);
    }

    function renounceOwnership() public pure override {
        revert("disabled");
    }

    function createAndFund(
        ConditionalSettlementParams calldata p,
        bytes calldata signature
    ) external whenNotPaused nonReentrant returns (bytes32 settlementId) {
        if (msg.sender != p.buyer) revert CallerNotBuyer();
        if (block.timestamp > p.expiresAt) revert DeadlineExpired();
        if (p.signerNonce != signerNonce) revert SignerNonceMismatch();
        if (p.buyer == address(0) || p.seller == address(0) || p.asset == address(0)) revert ZeroAddress();
        if (p.buyer == p.seller) revert BuyerIsSeller();
        if (!allowedAssets[p.asset]) revert AssetNotAllowed();
        if (p.grossAmount < MIN_GROSS_AMOUNT) revert AmountTooLow();

        settlementId = computeSettlementId(p);
        if (_settlements[settlementId].state != SettlementState.NONE) revert SettlementAlreadyExists();

        _verifyConditionalSettlement(p, signature);

        _storeSettlement(settlementId, p);
        IERC20(p.asset).safeTransferFrom(p.buyer, address(this), p.grossAmount);
        _emitSettlementFunded(settlementId, p);
    }

    function release(
        ReleaseParams calldata p,
        bytes calldata signature
    ) external whenNotPaused nonReentrant {
        SettlementRecord storage record = _settlements[p.settlementId];
        _requireOpen(record);
        if (block.timestamp > p.deadline) revert DeadlineExpired();
        if (p.signerNonce != signerNonce) revert SignerNonceMismatch();
        if (p.sellerWallet == address(0)) revert ZeroAddress();
        if (p.sellerWallet == address(this) || p.feeWallet == address(this)) revert RecipientIsContract();
        if (p.sellerWallet != record.seller) revert SellerWalletMismatch();
        if (p.sellerAmount + p.feeAmount != record.grossAmount) revert AmountMismatch();
        if (p.feeAmount * 10000 > record.grossAmount * MAX_FEE_BPS) revert FeeTooHigh();
        if (p.feeAmount > 0 && p.feeWallet == address(0)) revert ZeroAddress();

        _verifyRelease(p, signature);

        record.state = SettlementState.RELEASED;
        IERC20(record.asset).safeTransfer(p.sellerWallet, p.sellerAmount);
        if (p.feeAmount > 0) {
            IERC20(record.asset).safeTransfer(p.feeWallet, p.feeAmount);
        }

        emit SettlementReleased(p.settlementId, p.sellerWallet, p.feeWallet, p.sellerAmount, p.feeAmount);
    }

    function refund(
        RefundParams calldata p,
        bytes calldata signature
    ) external whenNotPaused nonReentrant {
        SettlementRecord storage record = _settlements[p.settlementId];
        _requireOpen(record);
        if (block.timestamp > p.deadline) revert DeadlineExpired();
        if (p.signerNonce != signerNonce) revert SignerNonceMismatch();

        _verifyRefund(p, signature);
        _refund(p.settlementId, record);
    }

    function expire(bytes32 settlementId) external whenNotPaused nonReentrant {
        SettlementRecord storage record = _settlements[settlementId];
        _requireOpen(record);
        if (record.state == SettlementState.DISPUTED) revert SettlementInDispute();
        if (block.timestamp <= record.expiresAt) revert SettlementNotExpired();
        _refund(settlementId, record);
    }

    function raiseDispute(bytes32 settlementId, bytes32 evidenceHash) external whenNotPaused {
        SettlementRecord storage record = _settlements[settlementId];
        _requireOpen(record);
        if (record.state == SettlementState.DISPUTED) revert SettlementAlreadyDisputed();
        if (msg.sender != record.buyer && msg.sender != record.seller) revert CallerNotParticipant();
        record.state = SettlementState.DISPUTED;
        record.disputeEvidenceHash = evidenceHash;
        emit SettlementDisputed(settlementId, evidenceHash);
    }

    function settlementState(bytes32 settlementId) external view returns (SettlementState) {
        return _settlements[settlementId].state;
    }

    function settlementPolicyHashes(bytes32 settlementId) external view returns (bytes32, bytes32, bytes32) {
        SettlementRecord storage record = _settlements[settlementId];
        return (record.approvalPolicyHash, record.agreementHash, record.listingHash);
    }

    function settlementParties(bytes32 settlementId) external view returns (address, address, uint256) {
        SettlementRecord storage record = _settlements[settlementId];
        return (record.buyer, record.seller, record.grossAmount);
    }

    function computeSettlementId(ConditionalSettlementParams calldata p) public view returns (bytes32) {
        return keccak256(abi.encode(
            p.orderId,
            p.paymentIntentId,
            p.approvalPolicyHash,
            p.buyer,
            p.seller,
            block.chainid
        ));
    }

    function allowAsset(address asset) external onlyOwner {
        if (asset == address(0)) revert ZeroAddress();
        allowedAssets[asset] = true;
        emit AssetAllowed(asset);
    }

    function disallowAsset(address asset) external onlyOwner {
        if (asset == address(0)) revert ZeroAddress();
        allowedAssets[asset] = false;
        emit AssetDisallowed(asset);
    }

    function setSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        address oldSigner = signer;
        signer = newSigner;
        signerNonce += 1;
        emit SignerUpdated(oldSigner, newSigner);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _requireOpen(SettlementRecord storage record) internal view {
        if (record.state == SettlementState.NONE) revert SettlementNotFunded();
        if (record.state == SettlementState.RELEASED || record.state == SettlementState.REFUNDED) {
            revert SettlementFinalized();
        }
    }

    function _storeSettlement(
        bytes32 settlementId,
        ConditionalSettlementParams calldata p
    ) internal {
        _settlements[settlementId] = SettlementRecord({
            state: SettlementState.FUNDED,
            orderId: p.orderId,
            paymentIntentId: p.paymentIntentId,
            approvalPolicyHash: p.approvalPolicyHash,
            agreementHash: p.agreementHash,
            listingHash: p.listingHash,
            grantNonce: p.grantNonce,
            buyer: p.buyer,
            seller: p.seller,
            asset: p.asset,
            grossAmount: p.grossAmount,
            expiresAt: p.expiresAt,
            disputeEvidenceHash: bytes32(0)
        });
    }

    function _emitSettlementFunded(
        bytes32 settlementId,
        ConditionalSettlementParams calldata p
    ) internal {
        emit SettlementFunded(
            settlementId,
            p.orderId,
            p.paymentIntentId,
            p.approvalPolicyHash,
            p.buyer,
            p.seller,
            p.asset,
            p.grossAmount,
            p.expiresAt
        );
    }

    function _refund(bytes32 settlementId, SettlementRecord storage record) internal {
        record.state = SettlementState.REFUNDED;
        IERC20(record.asset).safeTransfer(record.buyer, record.grossAmount);
        emit SettlementRefunded(settlementId, record.buyer, record.grossAmount);
    }

    function _verifyConditionalSettlement(
        ConditionalSettlementParams calldata p,
        bytes calldata signature
    ) internal view {
        bytes32 structHash = keccak256(abi.encode(
            CONDITIONAL_SETTLEMENT_TYPEHASH,
            p.orderId,
            p.paymentIntentId,
            p.approvalPolicyHash,
            p.agreementHash,
            p.listingHash,
            p.grantNonce,
            p.buyer,
            p.seller,
            p.asset,
            p.grossAmount,
            p.expiresAt,
            p.signerNonce
        ));
        _verifyDigest(structHash, signature);
    }

    function _verifyRelease(ReleaseParams calldata p, bytes calldata signature) internal view {
        bytes32 structHash = keccak256(abi.encode(
            RELEASE_TYPEHASH,
            p.settlementId,
            p.sellerWallet,
            p.feeWallet,
            p.sellerAmount,
            p.feeAmount,
            p.deadline,
            p.signerNonce
        ));
        _verifyDigest(structHash, signature);
    }

    function _verifyRefund(RefundParams calldata p, bytes calldata signature) internal view {
        bytes32 structHash = keccak256(abi.encode(
            REFUND_TYPEHASH,
            p.settlementId,
            p.deadline,
            p.signerNonce
        ));
        _verifyDigest(structHash, signature);
    }

    function _verifyDigest(bytes32 structHash, bytes calldata signature) internal view {
        if (signer == address(0)) revert SignerNotSet();
        bytes32 digest = _hashTypedDataV4(structHash);
        if (!SignatureChecker.isValidSignatureNow(signer, digest, signature)) {
            revert InvalidSignature();
        }
    }
}
