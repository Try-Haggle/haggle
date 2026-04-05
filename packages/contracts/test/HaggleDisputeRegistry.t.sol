// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../sol/HaggleDisputeRegistry.sol";

contract HaggleDisputeRegistryTest is Test {
    HaggleDisputeRegistry public registry;

    address owner = makeAddr("owner");
    address resolver = makeAddr("resolver");
    address randomUser = makeAddr("randomUser");

    bytes32 orderId = keccak256("order-1");
    bytes32 disputeCaseId = keccak256("dispute-1");
    bytes32 evidenceRootHash = keccak256("evidence-root");
    bytes32 resolutionHash = keccak256("resolution");

    function setUp() public {
        vm.prank(owner);
        registry = new HaggleDisputeRegistry(owner);

        vm.prank(owner);
        registry.grantResolver(resolver);
    }

    // ─── Deployment ───────────────────────────────────────────

    function test_deployment_setsOwner() public view {
        assertEq(registry.owner(), owner);
    }

    function test_deployment_ownerIsResolver() public view {
        assertTrue(registry.resolvers(owner));
    }

    function test_deployment_usesOwnable2Step() public view {
        assertEq(registry.pendingOwner(), address(0));
    }

    function test_deployment_maxAnchorsConstant() public view {
        assertEq(registry.MAX_ANCHORS_PER_ORDER(), 50);
    }

    function test_deployment_emitsResolverGranted() public {
        vm.expectEmit(true, false, false, false);
        emit HaggleDisputeRegistry.ResolverGranted(owner);
        vm.prank(owner);
        new HaggleDisputeRegistry(owner);
    }

    // ─── renounceOwnership disabled ─────────────────────────

    function test_revert_renounceOwnership() public {
        vm.prank(owner);
        vm.expectRevert("disabled");
        registry.renounceOwnership();
    }

    // ─── anchorDispute: happy path ────────────────────────────

    function test_anchorDispute_returnsAnchorId() public {
        vm.prank(resolver);
        bytes32 anchorId = registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);
        assertTrue(anchorId != bytes32(0));
    }

    function test_anchorDispute_emitsEvent() public {
        vm.expectEmit(false, true, false, true);
        emit HaggleDisputeRegistry.DisputeAnchored(
            bytes32(0), orderId, disputeCaseId, evidenceRootHash, resolutionHash
        );

        vm.prank(resolver);
        registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);
    }

    function test_anchorDispute_recordsAnchor() public {
        vm.prank(resolver);
        bytes32 anchorId = registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);

        (bytes32 storedOrderId, bytes32 storedCaseId, bytes32 storedEvidence, bytes32 storedResolution, uint256 ts,,) =
            registry.anchors(anchorId);

        assertEq(storedOrderId, orderId);
        assertEq(storedCaseId, disputeCaseId);
        assertEq(storedEvidence, evidenceRootHash);
        assertEq(storedResolution, resolutionHash);
        assertEq(ts, block.timestamp);
    }

    function test_anchorDispute_uniqueIds() public {
        vm.startPrank(resolver);
        bytes32 id1 = registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);

        bytes32 orderId2 = keccak256("order-2");
        bytes32 id2 = registry.anchorDispute(orderId2, disputeCaseId, evidenceRootHash, resolutionHash);
        vm.stopPrank();

        assertTrue(id1 != id2);
    }

    function test_anchorDispute_tracksOrderAnchors() public {
        vm.prank(resolver);
        bytes32 anchorId = registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);

        bytes32[] memory orderAnchors = registry.getOrderAnchors(orderId);
        assertEq(orderAnchors.length, 1);
        assertEq(orderAnchors[0], anchorId);
    }

    function test_anchorDispute_multipleAnchorsPerOrder() public {
        vm.startPrank(resolver);
        registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);

        bytes32 disputeCaseId2 = keccak256("dispute-2");
        registry.anchorDispute(orderId, disputeCaseId2, evidenceRootHash, resolutionHash);
        vm.stopPrank();

        bytes32[] memory orderAnchors = registry.getOrderAnchors(orderId);
        assertEq(orderAnchors.length, 2);
    }

    function test_getOrderAnchorCount() public {
        vm.startPrank(resolver);
        registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);
        registry.anchorDispute(orderId, keccak256("dispute-2"), evidenceRootHash, resolutionHash);
        vm.stopPrank();

        assertEq(registry.getOrderAnchorCount(orderId), 2);
    }

    function test_getOrderAnchors_emptyForNonExistentOrder() public view {
        bytes32 unknownOrder = keccak256("unknown");
        bytes32[] memory anchors = registry.getOrderAnchors(unknownOrder);
        assertEq(anchors.length, 0);
    }

    // ─── Duplicate dispute prevention ──────────────────────────

    function test_revert_duplicateDispute() public {
        vm.startPrank(resolver);
        registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);

        // Same orderId + disputeCaseId should revert
        vm.expectRevert(HaggleDisputeRegistry.DuplicateDispute.selector);
        registry.anchorDispute(orderId, disputeCaseId, keccak256("new-evidence"), keccak256("new-resolution"));
        vm.stopPrank();
    }

    function test_sameDisputeDifferentOrder_allowed() public {
        bytes32 orderId2 = keccak256("order-2");

        vm.startPrank(resolver);
        registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);
        // Same disputeCaseId but different orderId is fine
        registry.anchorDispute(orderId2, disputeCaseId, evidenceRootHash, resolutionHash);
        vm.stopPrank();

        assertEq(registry.getOrderAnchorCount(orderId), 1);
        assertEq(registry.getOrderAnchorCount(orderId2), 1);
    }

    // ─── anchorDispute: validation ────────────────────────────

    function test_revert_zeroOrderId() public {
        vm.prank(resolver);
        vm.expectRevert(HaggleDisputeRegistry.ZeroHash.selector);
        registry.anchorDispute(bytes32(0), disputeCaseId, evidenceRootHash, resolutionHash);
    }

    function test_revert_zeroDisputeCaseId() public {
        vm.prank(resolver);
        vm.expectRevert(HaggleDisputeRegistry.ZeroHash.selector);
        registry.anchorDispute(orderId, bytes32(0), evidenceRootHash, resolutionHash);
    }

    function test_revert_zeroEvidenceHash() public {
        vm.prank(resolver);
        vm.expectRevert(HaggleDisputeRegistry.ZeroHash.selector);
        registry.anchorDispute(orderId, disputeCaseId, bytes32(0), resolutionHash);
    }

    function test_revert_zeroResolutionHash() public {
        vm.prank(resolver);
        vm.expectRevert(HaggleDisputeRegistry.ZeroHash.selector);
        registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, bytes32(0));
    }

    // ─── [M-04] Max anchors per order ─────────────────────────

    function test_revert_tooManyAnchorsPerOrder() public {
        vm.startPrank(resolver);
        for (uint256 i = 0; i < 50; i++) {
            bytes32 caseId = keccak256(abi.encode("dispute", i));
            registry.anchorDispute(orderId, caseId, evidenceRootHash, resolutionHash);
        }

        // 51st should revert
        vm.expectRevert(HaggleDisputeRegistry.TooManyAnchors.selector);
        registry.anchorDispute(orderId, keccak256("dispute-overflow"), evidenceRootHash, resolutionHash);
        vm.stopPrank();

        assertEq(registry.getOrderAnchorCount(orderId), 50);
    }

    // ─── Access control ───────────────────────────────────────

    function test_revert_nonResolverCannotAnchor() public {
        vm.prank(randomUser);
        vm.expectRevert(HaggleDisputeRegistry.NotResolver.selector);
        registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);
    }

    function test_ownerCanAnchor() public {
        // Owner is auto-granted resolver in constructor
        vm.prank(owner);
        bytes32 anchorId = registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);
        assertTrue(anchorId != bytes32(0));
    }

    function test_grantResolver_onlyOwner() public {
        vm.prank(randomUser);
        vm.expectRevert();
        registry.grantResolver(randomUser);
    }

    function test_grantResolver_emitsEvent() public {
        address newResolver = makeAddr("newResolver");
        vm.prank(owner);
        vm.expectEmit(true, false, false, false);
        emit HaggleDisputeRegistry.ResolverGranted(newResolver);
        registry.grantResolver(newResolver);
    }

    function test_revokeResolver_works() public {
        vm.prank(owner);
        registry.revokeResolver(resolver);

        assertFalse(registry.resolvers(resolver));

        vm.prank(resolver);
        vm.expectRevert(HaggleDisputeRegistry.NotResolver.selector);
        registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);
    }

    function test_revokeResolver_emitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(true, false, false, false);
        emit HaggleDisputeRegistry.ResolverRevoked(resolver);
        registry.revokeResolver(resolver);
    }

    // [L-03] Cannot revoke owner's resolver status
    function test_revert_cannotRevokeOwnerResolver() public {
        vm.prank(owner);
        vm.expectRevert(HaggleDisputeRegistry.CannotRevokeOwner.selector);
        registry.revokeResolver(owner);
    }

    function test_reGrantRevokedResolver() public {
        vm.startPrank(owner);
        registry.revokeResolver(resolver);
        assertFalse(registry.resolvers(resolver));

        registry.grantResolver(resolver);
        assertTrue(registry.resolvers(resolver));
        vm.stopPrank();

        // Can anchor again
        vm.prank(resolver);
        bytes32 anchorId = registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);
        assertTrue(anchorId != bytes32(0));
    }

    function test_revokeNonResolver_noOp() public {
        // Revoking someone who isn't a resolver — should not revert
        address nobody = makeAddr("nobody");
        vm.prank(owner);
        registry.revokeResolver(nobody);
        assertFalse(registry.resolvers(nobody));
    }

    function test_revert_grantResolver_zeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(HaggleDisputeRegistry.ZeroAddress.selector);
        registry.grantResolver(address(0));
    }

    function test_revert_revokeResolver_zeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(HaggleDisputeRegistry.ZeroAddress.selector);
        registry.revokeResolver(address(0));
    }

    // ─── Ownable2Step ─────────────────────────────────────────

    function test_ownershipTransfer_twoStep() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(owner);
        registry.transferOwnership(newOwner);
        assertEq(registry.owner(), owner);
        assertEq(registry.pendingOwner(), newOwner);

        vm.prank(newOwner);
        registry.acceptOwnership();
        assertEq(registry.owner(), newOwner);
    }

    function test_ownershipTransfer_newOwnerCanManageResolvers() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(owner);
        registry.transferOwnership(newOwner);
        vm.prank(newOwner);
        registry.acceptOwnership();

        // New owner can grant resolvers
        address newResolver = makeAddr("newResolver");
        vm.prank(newOwner);
        registry.grantResolver(newResolver);
        assertTrue(registry.resolvers(newResolver));
    }

    // ─── [3rd Review] Ownership transfer resolver auto-management ─

    function test_ownershipTransfer_revokesOldOwnerResolver() public {
        address newOwner = makeAddr("newOwner");

        assertTrue(registry.resolvers(owner));

        vm.prank(owner);
        registry.transferOwnership(newOwner);
        vm.prank(newOwner);
        registry.acceptOwnership();

        // Old owner should no longer be resolver
        assertFalse(registry.resolvers(owner));
    }

    function test_ownershipTransfer_grantsNewOwnerResolver() public {
        address newOwner = makeAddr("newOwner");

        assertFalse(registry.resolvers(newOwner));

        vm.prank(owner);
        registry.transferOwnership(newOwner);
        vm.prank(newOwner);
        registry.acceptOwnership();

        // New owner should be resolver
        assertTrue(registry.resolvers(newOwner));
    }

    function test_ownershipTransfer_oldOwnerCannotAnchor() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(owner);
        registry.transferOwnership(newOwner);
        vm.prank(newOwner);
        registry.acceptOwnership();

        // Old owner should fail to anchor
        vm.prank(owner);
        vm.expectRevert(HaggleDisputeRegistry.NotResolver.selector);
        registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);
    }

    function test_ownershipTransfer_newOwnerCanAnchor() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(owner);
        registry.transferOwnership(newOwner);
        vm.prank(newOwner);
        registry.acceptOwnership();

        vm.prank(newOwner);
        bytes32 anchorId = registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);
        assertTrue(anchorId != bytes32(0));
    }

    // ─── Fuzz tests ───────────────────────────────────────────

    function testFuzz_anchorDispute_allNonZeroInputs(
        bytes32 _orderId,
        bytes32 _caseId,
        bytes32 _evidenceHash,
        bytes32 _resolutionHash
    ) public {
        vm.assume(_orderId != bytes32(0));
        vm.assume(_caseId != bytes32(0));
        vm.assume(_evidenceHash != bytes32(0));
        vm.assume(_resolutionHash != bytes32(0));

        vm.prank(resolver);
        bytes32 anchorId = registry.anchorDispute(_orderId, _caseId, _evidenceHash, _resolutionHash);
        assertTrue(anchorId != bytes32(0));

        (bytes32 storedOrderId,,,,,,) = registry.anchors(anchorId);
        assertEq(storedOrderId, _orderId);
    }

    // ─── [4th Review] supersedeAnchor ────────────────────────

    function test_supersedeAnchor_works() public {
        vm.prank(resolver);
        bytes32 oldId = registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);

        bytes32 newEvidence = keccak256("corrected-evidence");
        bytes32 newResolution = keccak256("corrected-resolution");

        vm.prank(resolver);
        bytes32 newId = registry.supersedeAnchor(oldId, newEvidence, newResolution);

        assertTrue(newId != bytes32(0));
        assertTrue(newId != oldId);

        // Old anchor marked as superseded
        (,,,,,bytes32 superseded,) = registry.anchors(oldId);
        assertEq(superseded, newId);

        // New anchor has correct data
        (bytes32 storedOrder, bytes32 storedCase, bytes32 storedEvidence, bytes32 storedRes, uint256 ts,,) =
            registry.anchors(newId);
        assertEq(storedOrder, orderId);
        assertEq(storedCase, disputeCaseId);
        assertEq(storedEvidence, newEvidence);
        assertEq(storedRes, newResolution);
        assertEq(ts, block.timestamp);
    }

    function test_supersedeAnchor_emitsEvents() public {
        vm.prank(resolver);
        bytes32 oldId = registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);

        vm.expectEmit(true, false, false, false);
        emit HaggleDisputeRegistry.AnchorSuperseded(oldId, bytes32(0));

        vm.prank(resolver);
        registry.supersedeAnchor(oldId, keccak256("new-e"), keccak256("new-r"));
    }

    function test_revert_supersedeAnchor_notFound() public {
        bytes32 fakeId = keccak256("nonexistent");
        vm.prank(resolver);
        vm.expectRevert(HaggleDisputeRegistry.AnchorNotFound.selector);
        registry.supersedeAnchor(fakeId, evidenceRootHash, resolutionHash);
    }

    function test_revert_supersedeAnchor_alreadySuperseded() public {
        vm.prank(resolver);
        bytes32 oldId = registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);

        vm.prank(resolver);
        registry.supersedeAnchor(oldId, keccak256("new-e"), keccak256("new-r"));

        // Cannot supersede again
        vm.prank(resolver);
        vm.expectRevert(HaggleDisputeRegistry.AlreadySuperseded.selector);
        registry.supersedeAnchor(oldId, keccak256("new-e2"), keccak256("new-r2"));
    }

    function test_revert_supersedeAnchor_zeroHash() public {
        vm.prank(resolver);
        bytes32 oldId = registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);

        vm.prank(resolver);
        vm.expectRevert(HaggleDisputeRegistry.ZeroHash.selector);
        registry.supersedeAnchor(oldId, bytes32(0), keccak256("new-r"));
    }

    function test_revert_supersedeAnchor_nonResolver() public {
        vm.prank(resolver);
        bytes32 oldId = registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);

        vm.prank(randomUser);
        vm.expectRevert(HaggleDisputeRegistry.NotResolver.selector);
        registry.supersedeAnchor(oldId, keccak256("new-e"), keccak256("new-r"));
    }

    function test_supersedeAnchor_incrementsOrderAnchors() public {
        vm.prank(resolver);
        bytes32 oldId = registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);
        assertEq(registry.getOrderAnchorCount(orderId), 1);

        vm.prank(resolver);
        registry.supersedeAnchor(oldId, keccak256("new-e"), keccak256("new-r"));
        // Old + new = 2 entries in order anchors (preserves audit trail)
        assertEq(registry.getOrderAnchorCount(orderId), 2);
    }

    // ─── [Manual Override] revokeAnchor ──────────────────────

    function test_revokeAnchor_works() public {
        vm.prank(resolver);
        bytes32 aid = registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);

        vm.prank(owner);
        registry.revokeAnchor(aid, "fraudulent resolution");

        (,,,,,,bool revoked) = registry.anchors(aid);
        assertTrue(revoked);

        // Duplicate guard reset → can re-anchor same dispute
        assertFalse(registry.disputeAnchored(orderId, disputeCaseId));
    }

    function test_revokeAnchor_emitsEvent() public {
        vm.prank(resolver);
        bytes32 aid = registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);

        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit HaggleDisputeRegistry.AnchorRevoked(aid, "bad data");
        registry.revokeAnchor(aid, "bad data");
    }

    function test_revokeAnchor_allowsReAnchor() public {
        vm.prank(resolver);
        bytes32 aid = registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);

        vm.prank(owner);
        registry.revokeAnchor(aid, "wrong resolution");

        // Re-anchor the same dispute with correct data
        vm.prank(resolver);
        bytes32 newAid = registry.anchorDispute(orderId, disputeCaseId, keccak256("correct-evidence"), keccak256("correct-resolution"));
        assertTrue(newAid != bytes32(0));
        assertTrue(newAid != aid);
    }

    function test_revert_revokeAnchor_notFound() public {
        vm.prank(owner);
        vm.expectRevert(HaggleDisputeRegistry.AnchorNotFound.selector);
        registry.revokeAnchor(keccak256("nonexistent"), "test");
    }

    function test_revert_revokeAnchor_alreadyRevoked() public {
        vm.prank(resolver);
        bytes32 aid = registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);

        vm.startPrank(owner);
        registry.revokeAnchor(aid, "first");
        vm.expectRevert(HaggleDisputeRegistry.AnchorAlreadyRevoked.selector);
        registry.revokeAnchor(aid, "second");
        vm.stopPrank();
    }

    function test_revert_revokeAnchor_onlyOwner() public {
        vm.prank(resolver);
        bytes32 aid = registry.anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash);

        // Resolver cannot revoke — only owner
        vm.prank(resolver);
        vm.expectRevert();
        registry.revokeAnchor(aid, "test");
    }
}
