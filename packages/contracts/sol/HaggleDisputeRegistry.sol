// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title HaggleDisputeRegistry
/// @notice On-chain anchor for dispute resolutions. Stores immutable evidence
///         and resolution hashes so neither party can claim the outcome was tampered.
///         Does not hold funds — purely a record-keeping contract.
/// @dev Uses Ownable2Step for safer ownership transfer. Resolver role is separate from owner.
contract HaggleDisputeRegistry is Ownable2Step {
    // ─── Constants ────────────────────────────────────────────
    uint256 public constant MAX_ANCHORS_PER_ORDER = 50;

    // ─── Errors ───────────────────────────────────────────────
    error ZeroHash();
    error NotResolver();
    error TooManyAnchors();
    error CannotRevokeOwner();
    error ZeroAddress();
    error DuplicateDispute();
    error AnchorNotFound();
    error AlreadySuperseded();
    error AnchorAlreadyRevoked();

    // ─── Events ───────────────────────────────────────────────
    event DisputeAnchored(
        bytes32 indexed anchorId,
        bytes32 indexed orderId,
        bytes32 disputeCaseId,
        bytes32 evidenceRootHash,
        bytes32 resolutionHash
    );

    event ResolverGranted(address indexed resolver);
    event ResolverRevoked(address indexed resolver);
    event AnchorSuperseded(bytes32 indexed oldAnchorId, bytes32 indexed newAnchorId);
    event AnchorRevoked(bytes32 indexed anchorId, string reason);

    // ─── Types ────────────────────────────────────────────────
    struct Anchor {
        bytes32 orderId;
        bytes32 disputeCaseId;
        bytes32 evidenceRootHash;
        bytes32 resolutionHash;
        uint256 anchoredAt;
        bytes32 supersededBy;
        bool revoked;
    }

    // ─── State ────────────────────────────────────────────────
    mapping(bytes32 => Anchor) public anchors;
    mapping(bytes32 => bytes32[]) private _orderAnchors;
    mapping(address => bool) public resolvers;
    mapping(bytes32 => mapping(bytes32 => bool)) public disputeAnchored;
    uint256 private _nonce;

    // ─── Modifiers ────────────────────────────────────────────
    modifier onlyResolver() {
        if (!resolvers[msg.sender]) revert NotResolver();
        _;
    }

    // ─── Constructor ──────────────────────────────────────────
    constructor(address initialOwner) Ownable(initialOwner) {
        resolvers[initialOwner] = true;
        emit ResolverGranted(initialOwner);
    }

    // ─── Disable renounceOwnership ──────────────────────────
    /// @notice Disabled to prevent accidental permanent lock.
    function renounceOwnership() public pure override {
        revert("disabled");
    }

    /// @notice Auto-manage resolver role on ownership transfer.
    ///         Revokes old owner's resolver, grants new owner resolver.
    function _transferOwnership(address newOwner) internal override {
        address oldOwner = owner();
        if (oldOwner != address(0) && oldOwner != newOwner) {
            resolvers[oldOwner] = false;
            emit ResolverRevoked(oldOwner);
        }
        super._transferOwnership(newOwner);
        if (newOwner != address(0) && !resolvers[newOwner]) {
            resolvers[newOwner] = true;
            emit ResolverGranted(newOwner);
        }
    }

    // ─── Core ─────────────────────────────────────────────────

    /// @notice Anchor a dispute resolution on-chain for immutable record-keeping.
    /// @dev Only callable by authorized resolvers (Haggle API backend).
    /// @param orderId The order this dispute pertains to.
    /// @param disputeCaseId Unique dispute case identifier.
    /// @param evidenceRootHash Merkle root of submitted evidence.
    /// @param resolutionHash Hash of the resolution decision.
    /// @return anchorId Unique identifier for this dispute anchor.
    function anchorDispute(
        bytes32 orderId,
        bytes32 disputeCaseId,
        bytes32 evidenceRootHash,
        bytes32 resolutionHash
    ) external onlyResolver returns (bytes32 anchorId) {
        if (orderId == bytes32(0) || disputeCaseId == bytes32(0)) revert ZeroHash();
        if (evidenceRootHash == bytes32(0) || resolutionHash == bytes32(0)) revert ZeroHash();
        if (disputeAnchored[orderId][disputeCaseId]) revert DuplicateDispute();
        disputeAnchored[orderId][disputeCaseId] = true;

        // Cap anchors per order to prevent DoS
        if (_orderAnchors[orderId].length >= MAX_ANCHORS_PER_ORDER) revert TooManyAnchors();

        // Deterministic ID: no block.timestamp, use abi.encode
        anchorId = keccak256(abi.encode(orderId, disputeCaseId, block.chainid, ++_nonce));

        anchors[anchorId] = Anchor({
            orderId: orderId,
            disputeCaseId: disputeCaseId,
            evidenceRootHash: evidenceRootHash,
            resolutionHash: resolutionHash,
            anchoredAt: block.timestamp,
            supersededBy: bytes32(0),
            revoked: false
        });

        _orderAnchors[orderId].push(anchorId);

        emit DisputeAnchored(anchorId, orderId, disputeCaseId, evidenceRootHash, resolutionHash);
    }

    /// @notice Supersede an existing anchor with a corrected one.
    /// @dev Original record is preserved (immutable audit trail). Only resolver can supersede.
    ///      Resets the DuplicateDispute guard so a new anchor can be created for the same dispute.
    /// @param oldAnchorId The anchor to mark as superseded.
    /// @param newEvidenceRootHash Corrected evidence hash.
    /// @param newResolutionHash Corrected resolution hash.
    /// @return newAnchorId The replacement anchor ID.
    function supersedeAnchor(
        bytes32 oldAnchorId,
        bytes32 newEvidenceRootHash,
        bytes32 newResolutionHash
    ) external onlyResolver returns (bytes32 newAnchorId) {
        Anchor storage old = anchors[oldAnchorId];
        if (old.orderId == bytes32(0)) revert AnchorNotFound();
        if (old.supersededBy != bytes32(0)) revert AlreadySuperseded();
        if (newEvidenceRootHash == bytes32(0) || newResolutionHash == bytes32(0)) revert ZeroHash();

        // Reset duplicate guard so we can re-anchor
        disputeAnchored[old.orderId][old.disputeCaseId] = false;

        // Create replacement anchor (reuses anchorDispute logic inline)
        newAnchorId = keccak256(abi.encode(old.orderId, old.disputeCaseId, block.chainid, ++_nonce));
        disputeAnchored[old.orderId][old.disputeCaseId] = true;

        anchors[newAnchorId] = Anchor({
            orderId: old.orderId,
            disputeCaseId: old.disputeCaseId,
            evidenceRootHash: newEvidenceRootHash,
            resolutionHash: newResolutionHash,
            anchoredAt: block.timestamp,
            supersededBy: bytes32(0),
            revoked: false
        });

        _orderAnchors[old.orderId].push(newAnchorId);

        // Mark old as superseded
        old.supersededBy = newAnchorId;

        emit AnchorSuperseded(oldAnchorId, newAnchorId);
        emit DisputeAnchored(newAnchorId, old.orderId, old.disputeCaseId, newEvidenceRootHash, newResolutionHash);
    }

    /// @notice Revoke an anchor without replacement. Use for fraudulent or erroneous records.
    /// @dev Only owner can revoke (not resolvers) — this is an admin-level correction.
    ///      Original data is preserved for audit trail; `revoked` flag marks it invalid.
    /// @param anchorId The anchor to revoke.
    /// @param reason Human-readable reason for audit trail.
    function revokeAnchor(bytes32 anchorId, string calldata reason) external onlyOwner {
        Anchor storage a = anchors[anchorId];
        if (a.orderId == bytes32(0)) revert AnchorNotFound();
        if (a.revoked) revert AnchorAlreadyRevoked();
        a.revoked = true;
        // Reset duplicate guard so the dispute can be re-anchored if needed
        disputeAnchored[a.orderId][a.disputeCaseId] = false;
        emit AnchorRevoked(anchorId, reason);
    }

    // ─── Views ────────────────────────────────────────────────

    /// @notice Get all anchor IDs for a given order.
    /// @param orderId The order to query.
    /// @return Array of anchor IDs (max MAX_ANCHORS_PER_ORDER elements).
    function getOrderAnchors(bytes32 orderId) external view returns (bytes32[] memory) {
        return _orderAnchors[orderId];
    }

    /// @notice Get the number of anchors for a given order.
    /// @param orderId The order to query.
    /// @return Number of anchors for this order.
    function getOrderAnchorCount(bytes32 orderId) external view returns (uint256) {
        return _orderAnchors[orderId].length;
    }

    // ─── Admin ────────────────────────────────────────────────

    /// @notice Grant resolver role to an address.
    /// @param resolver Address to grant resolver role.
    function grantResolver(address resolver) external onlyOwner {
        if (resolver == address(0)) revert ZeroAddress();
        resolvers[resolver] = true;
        emit ResolverGranted(resolver);
    }

    /// @notice Revoke resolver role. Cannot revoke the current owner.
    /// @param resolver Address to revoke resolver role from.
    function revokeResolver(address resolver) external onlyOwner {
        if (resolver == address(0)) revert ZeroAddress();
        if (resolver == owner()) revert CannotRevokeOwner();
        resolvers[resolver] = false;
        emit ResolverRevoked(resolver);
    }
}
