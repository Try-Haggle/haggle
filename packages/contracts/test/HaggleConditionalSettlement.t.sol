// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../sol/HaggleConditionalSettlement.sol";
import "./MockUSDC.sol";

contract HaggleConditionalSettlementTest is Test {
    HaggleConditionalSettlement public settlement;
    MockUSDC public usdc;

    uint256 constant SIGNER_PK = 0xB0B;
    address signerAddr;

    address owner = makeAddr("owner");
    address buyer = makeAddr("buyer");
    address seller = makeAddr("sellerWallet");
    address alternateSellerWallet = makeAddr("alternateSellerWallet");
    address feeWallet = makeAddr("feeWallet");
    address attacker = makeAddr("attacker");

    bytes32 orderId = keccak256("order-1");
    bytes32 paymentIntentId = keccak256("payment-1");
    bytes32 policyHash = keccak256("policy-1");
    bytes32 agreementHash = keccak256("agreement-1");
    bytes32 listingHash = keccak256("listing-1");
    bytes32 grantNonce = keccak256("grant-nonce-1");

    uint256 grossAmount = 100_000_000;
    uint256 sellerAmount = 98_500_000;
    uint256 feeAmount = 1_500_000;

    function setUp() public {
        signerAddr = vm.addr(SIGNER_PK);

        vm.startPrank(owner);
        settlement = new HaggleConditionalSettlement(owner, signerAddr);
        usdc = new MockUSDC();
        settlement.allowAsset(address(usdc));
        vm.stopPrank();

        usdc.mint(buyer, 1_000_000_000);
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("HaggleConditionalSettlement"),
            keccak256("1"),
            block.chainid,
            address(settlement)
        ));
    }

    function _signCreate(
        uint256 pk,
        HaggleConditionalSettlement.ConditionalSettlementParams memory p
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            settlement.CONDITIONAL_SETTLEMENT_TYPEHASH(),
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
        return _sign(pk, structHash);
    }

    function _signRelease(
        uint256 pk,
        HaggleConditionalSettlement.ReleaseParams memory p
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            settlement.RELEASE_TYPEHASH(),
            p.settlementId,
            p.sellerWallet,
            p.feeWallet,
            p.sellerAmount,
            p.feeAmount,
            p.deadline,
            p.signerNonce
        ));
        return _sign(pk, structHash);
    }

    function _signRefund(
        uint256 pk,
        HaggleConditionalSettlement.RefundParams memory p
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            settlement.REFUND_TYPEHASH(),
            p.settlementId,
            p.deadline,
            p.signerNonce
        ));
        return _sign(pk, structHash);
    }

    function _sign(uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _defaultParams() internal view returns (HaggleConditionalSettlement.ConditionalSettlementParams memory) {
        return HaggleConditionalSettlement.ConditionalSettlementParams({
            orderId: orderId,
            paymentIntentId: paymentIntentId,
            approvalPolicyHash: policyHash,
            agreementHash: agreementHash,
            listingHash: listingHash,
            grantNonce: grantNonce,
            buyer: buyer,
            seller: seller,
            asset: address(usdc),
            grossAmount: grossAmount,
            expiresAt: block.timestamp + 1 days,
            signerNonce: settlement.signerNonce()
        });
    }

    function _fund() internal returns (bytes32 settlementId) {
        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        bytes memory sig = _signCreate(SIGNER_PK, p);
        settlementId = settlement.computeSettlementId(p);

        vm.startPrank(buyer);
        usdc.approve(address(settlement), grossAmount);
        settlement.createAndFund(p, sig);
        vm.stopPrank();
    }

    function test_createAndFund_locksBuyerFundsAndStoresPolicyHashes() public {
        bytes32 settlementId = _fund();

        assertEq(usdc.balanceOf(address(settlement)), grossAmount);
        assertEq(usdc.balanceOf(buyer), 1_000_000_000 - grossAmount);

        HaggleConditionalSettlement.SettlementState state = settlement.settlementState(settlementId);
        (bytes32 storedPolicyHash, bytes32 storedAgreementHash, bytes32 storedListingHash) =
            settlement.settlementPolicyHashes(settlementId);
        (address storedBuyer, address storedSeller, uint256 storedGrossAmount) =
            settlement.settlementParties(settlementId);

        assertEq(uint8(state), uint8(HaggleConditionalSettlement.SettlementState.FUNDED));
        assertEq(storedPolicyHash, policyHash);
        assertEq(storedAgreementHash, agreementHash);
        assertEq(storedListingHash, listingHash);
        assertEq(storedBuyer, buyer);
        assertEq(storedSeller, seller);
        assertEq(storedGrossAmount, grossAmount);
    }

    function test_release_splitsFundsWithPolicySignature() public {
        bytes32 settlementId = _fund();
        HaggleConditionalSettlement.ReleaseParams memory p = HaggleConditionalSettlement.ReleaseParams({
            settlementId: settlementId,
            sellerWallet: seller,
            feeWallet: feeWallet,
            sellerAmount: sellerAmount,
            feeAmount: feeAmount,
            deadline: block.timestamp + 1 hours,
            signerNonce: settlement.signerNonce()
        });
        bytes memory sig = _signRelease(SIGNER_PK, p);

        settlement.release(p, sig);

        assertEq(usdc.balanceOf(seller), sellerAmount);
        assertEq(usdc.balanceOf(feeWallet), feeAmount);
        assertEq(usdc.balanceOf(address(settlement)), 0);
    }

    function test_refund_returnsFundsWithPolicySignature() public {
        bytes32 settlementId = _fund();
        HaggleConditionalSettlement.RefundParams memory p = HaggleConditionalSettlement.RefundParams({
            settlementId: settlementId,
            deadline: block.timestamp + 1 hours,
            signerNonce: settlement.signerNonce()
        });
        bytes memory sig = _signRefund(SIGNER_PK, p);

        settlement.refund(p, sig);

        assertEq(usdc.balanceOf(buyer), 1_000_000_000);
        assertEq(usdc.balanceOf(address(settlement)), 0);
    }

    function test_expire_returnsFundsToBuyerWithoutAdminCustody() public {
        bytes32 settlementId = _fund();

        vm.warp(block.timestamp + 2 days);
        settlement.expire(settlementId);

        assertEq(usdc.balanceOf(buyer), 1_000_000_000);
        assertEq(usdc.balanceOf(address(settlement)), 0);
    }

    function test_revert_attackerCannotFundForBuyer() public {
        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        bytes memory sig = _signCreate(SIGNER_PK, p);

        vm.prank(attacker);
        vm.expectRevert(HaggleConditionalSettlement.CallerNotBuyer.selector);
        settlement.createAndFund(p, sig);
    }

    function test_revert_tamperedAgreementHashInvalidatesSignature() public {
        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        bytes memory sig = _signCreate(SIGNER_PK, p);
        p.agreementHash = keccak256("tampered-agreement");

        vm.startPrank(buyer);
        usdc.approve(address(settlement), grossAmount);
        vm.expectRevert(HaggleConditionalSettlement.InvalidSignature.selector);
        settlement.createAndFund(p, sig);
        vm.stopPrank();
    }

    function test_revert_tamperedListingHashInvalidatesSignature() public {
        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        bytes memory sig = _signCreate(SIGNER_PK, p);
        p.listingHash = keccak256("tampered-listing");

        vm.startPrank(buyer);
        usdc.approve(address(settlement), grossAmount);
        vm.expectRevert(HaggleConditionalSettlement.InvalidSignature.selector);
        settlement.createAndFund(p, sig);
        vm.stopPrank();
    }

    function test_revert_releaseRejectsFeeAboveCap() public {
        bytes32 settlementId = _fund();
        HaggleConditionalSettlement.ReleaseParams memory p = HaggleConditionalSettlement.ReleaseParams({
            settlementId: settlementId,
            sellerWallet: seller,
            feeWallet: feeWallet,
            sellerAmount: 80_000_000,
            feeAmount: 20_000_000,
            deadline: block.timestamp + 1 hours,
            signerNonce: settlement.signerNonce()
        });
        bytes memory sig = _signRelease(SIGNER_PK, p);

        vm.expectRevert(HaggleConditionalSettlement.FeeTooHigh.selector);
        settlement.release(p, sig);
    }

    function test_revert_releaseRejectsSellerWalletMismatchEvenWithValidSignature() public {
        bytes32 settlementId = _fund();
        HaggleConditionalSettlement.ReleaseParams memory p = HaggleConditionalSettlement.ReleaseParams({
            settlementId: settlementId,
            sellerWallet: alternateSellerWallet,
            feeWallet: feeWallet,
            sellerAmount: sellerAmount,
            feeAmount: feeAmount,
            deadline: block.timestamp + 1 hours,
            signerNonce: settlement.signerNonce()
        });
        bytes memory sig = _signRelease(SIGNER_PK, p);

        vm.expectRevert(HaggleConditionalSettlement.SellerWalletMismatch.selector);
        settlement.release(p, sig);
    }

    function test_disputeKeepsFundsLockedUntilSignedResolution() public {
        bytes32 settlementId = _fund();

        vm.prank(buyer);
        settlement.raiseDispute(settlementId, keccak256("evidence"));

        assertEq(usdc.balanceOf(address(settlement)), grossAmount);

        HaggleConditionalSettlement.RefundParams memory p = HaggleConditionalSettlement.RefundParams({
            settlementId: settlementId,
            deadline: block.timestamp + 1 hours,
            signerNonce: settlement.signerNonce()
        });
        settlement.refund(p, _signRefund(SIGNER_PK, p));
        assertEq(usdc.balanceOf(buyer), 1_000_000_000);
    }

    function test_disputeCanReleaseAfterSignedSellerFavorResolution() public {
        bytes32 settlementId = _fund();

        vm.prank(buyer);
        settlement.raiseDispute(settlementId, keccak256("evidence"));

        HaggleConditionalSettlement.ReleaseParams memory p = HaggleConditionalSettlement.ReleaseParams({
            settlementId: settlementId,
            sellerWallet: seller,
            feeWallet: feeWallet,
            sellerAmount: sellerAmount,
            feeAmount: feeAmount,
            deadline: block.timestamp + 1 hours,
            signerNonce: settlement.signerNonce()
        });
        settlement.release(p, _signRelease(SIGNER_PK, p));

        assertEq(usdc.balanceOf(seller), sellerAmount);
        assertEq(usdc.balanceOf(feeWallet), feeAmount);
        assertEq(usdc.balanceOf(address(settlement)), 0);
        assertEq(
            uint8(settlement.settlementState(settlementId)),
            uint8(HaggleConditionalSettlement.SettlementState.RELEASED)
        );
    }

    function test_revert_disputeEvidenceCannotBeOverwritten() public {
        bytes32 settlementId = _fund();

        vm.prank(buyer);
        settlement.raiseDispute(settlementId, keccak256("buyer-evidence"));

        vm.prank(seller);
        vm.expectRevert(HaggleConditionalSettlement.SettlementAlreadyDisputed.selector);
        settlement.raiseDispute(settlementId, keccak256("seller-overwrite"));
    }

    function test_revert_disputedSettlementCannotBypassResolutionThroughExpiry() public {
        HaggleConditionalSettlement.ConditionalSettlementParams memory params = _defaultParams();
        bytes32 settlementId = _fund();

        vm.prank(buyer);
        settlement.raiseDispute(settlementId, keccak256("evidence"));
        vm.warp(params.expiresAt + 1);

        vm.expectRevert(HaggleConditionalSettlement.SettlementInDispute.selector);
        settlement.expire(settlementId);
        assertEq(usdc.balanceOf(address(settlement)), grossAmount);
    }
}
