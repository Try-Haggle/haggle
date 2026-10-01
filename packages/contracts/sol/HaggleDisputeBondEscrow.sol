// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Holds both parties' review bonds separately from order principal.
/// @dev Review fees remain reserved until a separately approved payout action.
contract HaggleDisputeBondEscrow is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum TierState { NONE, AWAITING_BONDS, REVIEW_STARTED, CANCELLED, FINALIZED }
    enum Party { BUYER, SELLER }

    struct Tier {
        address buyer;
        address seller;
        uint128 fee;
        uint64 deadline;
        TierState state;
        bool buyerFunded;
        bool sellerFunded;
    }

    IERC20 public immutable asset;
    address public immutable feeVault;
    address public operator;
    mapping(bytes32 => mapping(uint8 => Tier)) public tiers;
    mapping(bytes32 => bool) public caseFinalized;
    mapping(bytes32 => bool) public caseSellerWon;
    mapping(bytes32 => bool) public caseSellerDefault;
    mapping(bytes32 => uint256) public accruedFees;

    error InvalidTier();
    error InvalidParty();
    error InvalidAmount();
    error InvalidState();
    error FundingClosed();
    error AlreadyFunded();
    error BondsIncomplete();
    error CaseAlreadyFinalized();
    error DefaultNotProven();
    error NothingToRelease();
    error UnauthorizedOperator();

    event TierOpened(bytes32 indexed disputeId, uint8 indexed tier, uint256 fee, uint256 deadline);
    event BondFunded(bytes32 indexed disputeId, uint8 indexed tier, Party party, address payer, uint256 amount);
    event ReviewStarted(bytes32 indexed disputeId, uint8 indexed tier);
    event TierCancelled(bytes32 indexed disputeId, uint8 indexed tier);
    event CaseFinalized(bytes32 indexed disputeId, bool sellerWon, uint256 feesReserved);
    event FeesReleased(bytes32 indexed disputeId, uint256 amount);
    event OperatorChanged(address indexed previousOperator, address indexed nextOperator);

    modifier onlyOperator() {
        if (msg.sender != operator) revert UnauthorizedOperator();
        _;
    }

    constructor(IERC20 asset_, address feeVault_, address operator_) Ownable(msg.sender) {
        if (address(asset_) == address(0) || feeVault_ == address(0) || operator_ == address(0)) revert InvalidParty();
        asset = asset_;
        feeVault = feeVault_;
        operator = operator_;
    }

    function setOperator(address nextOperator) external onlyOwner {
        if (nextOperator == address(0)) revert InvalidParty();
        emit OperatorChanged(operator, nextOperator);
        operator = nextOperator;
    }

    function openTier(
        bytes32 disputeId,
        uint8 tier,
        address buyer,
        address seller,
        uint128 fee,
        uint64 deadline
    ) external onlyOperator {
        if (tier != 2 && tier != 3) revert InvalidTier();
        if (buyer == address(0) || seller == address(0) || buyer == seller) revert InvalidParty();
        if (fee == 0 || deadline <= block.timestamp) revert InvalidAmount();
        if (caseFinalized[disputeId]) revert CaseAlreadyFinalized();
        if (tiers[disputeId][tier].state != TierState.NONE) revert InvalidState();
        if (tier == 3 && tiers[disputeId][2].state != TierState.REVIEW_STARTED) revert InvalidState();
        tiers[disputeId][tier] = Tier(buyer, seller, fee, deadline, TierState.AWAITING_BONDS, false, false);
        emit TierOpened(disputeId, tier, fee, deadline);
    }

    function fund(bytes32 disputeId, uint8 tier, Party party) external nonReentrant {
        _fund(disputeId, tier, party, msg.sender);
    }

    /// @notice A relayer can submit a party's already approved transfer.
    function fundFor(bytes32 disputeId, uint8 tier, Party party, address payer) external onlyOperator nonReentrant {
        _fund(disputeId, tier, party, payer);
    }

    function _fund(bytes32 disputeId, uint8 tier, Party party, address payer) private {
        Tier storage review = tiers[disputeId][tier];
        if (review.state != TierState.AWAITING_BONDS) revert InvalidState();
        if (block.timestamp > review.deadline) revert FundingClosed();
        if (party == Party.BUYER) {
            if (payer != review.buyer) revert InvalidParty();
            if (review.buyerFunded) revert AlreadyFunded();
            review.buyerFunded = true;
        } else {
            if (payer != review.seller) revert InvalidParty();
            if (review.sellerFunded) revert AlreadyFunded();
            review.sellerFunded = true;
        }
        asset.safeTransferFrom(payer, address(this), review.fee);
        emit BondFunded(disputeId, tier, party, payer, review.fee);
    }

    function startReview(bytes32 disputeId, uint8 tier) external onlyOperator {
        Tier storage review = tiers[disputeId][tier];
        if (review.state != TierState.AWAITING_BONDS) revert InvalidState();
        if (!review.buyerFunded || !review.sellerFunded) revert BondsIncomplete();
        review.state = TierState.REVIEW_STARTED;
        emit ReviewStarted(disputeId, tier);
    }

    function cancelUnstarted(bytes32 disputeId, uint8 tier) external onlyOperator nonReentrant {
        Tier storage review = tiers[disputeId][tier];
        if (review.state != TierState.AWAITING_BONDS) revert InvalidState();
        review.state = TierState.CANCELLED;
        if (review.buyerFunded) asset.safeTransfer(review.buyer, review.fee);
        if (review.sellerFunded) asset.safeTransfer(review.seller, review.fee);
        emit TierCancelled(disputeId, tier);
    }

    /// @notice Release winner bonds and retain only completed-tier fees from loser.
    /// An unstarted tier has zero fee and its deposits are returned to their owners.
    function finalizeCase(bytes32 disputeId, bool sellerWon) external onlyOperator nonReentrant {
        _finalize(disputeId, sellerWon);
    }

    function finalizeSellerDefault(bytes32 disputeId, uint8 tier) external onlyOperator nonReentrant {
        Tier storage review = tiers[disputeId][tier];
        if (review.state != TierState.AWAITING_BONDS || block.timestamp <= review.deadline ||
            !review.buyerFunded || review.sellerFunded) revert DefaultNotProven();
        caseSellerDefault[disputeId] = true;
        _finalize(disputeId, false);
    }

    function _finalize(bytes32 disputeId, bool sellerWon) private {
        if (caseFinalized[disputeId]) revert CaseAlreadyFinalized();
        uint256 fees;
        uint256 returned;
        for (uint8 tier = 2; tier <= 3; tier++) {
            Tier storage review = tiers[disputeId][tier];
            if (review.state == TierState.REVIEW_STARTED) {
                fees += review.fee;
                review.state = TierState.FINALIZED;
                asset.safeTransfer(sellerWon ? review.seller : review.buyer, review.fee);
                returned += review.fee;
            } else if (review.state == TierState.AWAITING_BONDS) {
                review.state = TierState.CANCELLED;
                if (review.buyerFunded) {
                    asset.safeTransfer(review.buyer, review.fee);
                    returned += review.fee;
                }
                if (review.sellerFunded) {
                    asset.safeTransfer(review.seller, review.fee);
                    returned += review.fee;
                }
                emit TierCancelled(disputeId, tier);
            }
        }
        if (fees == 0 && returned == 0) revert InvalidState();
        caseFinalized[disputeId] = true;
        caseSellerWon[disputeId] = sellerWon;
        accruedFees[disputeId] = fees;
        emit CaseFinalized(disputeId, sellerWon, fees);
    }

    /// @notice This is deliberately not invoked by finalization. Fee payout
    /// requires a later, separate decision and action.
    function releaseFees(bytes32 disputeId) external onlyOwner nonReentrant {
        uint256 amount = accruedFees[disputeId];
        if (amount == 0) revert NothingToRelease();
        accruedFees[disputeId] = 0;
        asset.safeTransfer(feeVault, amount);
        emit FeesReleased(disputeId, amount);
    }
}
