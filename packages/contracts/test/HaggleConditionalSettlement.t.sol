// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "../sol/HaggleConditionalSettlement.sol";
import "./MockUSDC.sol";

contract MockConditionalSettlementSigner is IERC1271 {
    bytes4 internal constant MAGIC_VALUE = IERC1271.isValidSignature.selector;
    mapping(bytes32 => bool) public approvedDigests;

    function approveDigest(bytes32 digest) external {
        approvedDigests[digest] = true;
    }

    function isValidSignature(bytes32 digest, bytes memory) external view returns (bytes4) {
        return approvedDigests[digest] ? MAGIC_VALUE : bytes4(0xffffffff);
    }
}

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
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("HaggleConditionalSettlement"),
                keccak256("1"),
                block.chainid,
                address(settlement)
            )
        );
    }

    function _signCreate(uint256 pk, HaggleConditionalSettlement.ConditionalSettlementParams memory p)
        internal
        view
        returns (bytes memory)
    {
        return _sign(pk, _createStructHash(p));
    }

    function _createStructHash(HaggleConditionalSettlement.ConditionalSettlementParams memory p)
        internal
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
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
            )
        );
    }

    function _typedDataDigest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function _signRelease(uint256 pk, HaggleConditionalSettlement.ReleaseParams memory p)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                settlement.RELEASE_TYPEHASH(),
                p.settlementId,
                p.sellerWallet,
                p.feeWallet,
                p.sellerAmount,
                p.feeAmount,
                p.deadline,
                p.signerNonce
            )
        );
        return _sign(pk, structHash);
    }

    function _signRefund(uint256 pk, HaggleConditionalSettlement.RefundParams memory p)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash =
            keccak256(abi.encode(settlement.REFUND_TYPEHASH(), p.settlementId, p.deadline, p.signerNonce));
        return _sign(pk, structHash);
    }

    function _sign(uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = _typedDataDigest(structHash);
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

    function _releaseParams(bytes32 settlementId)
        internal
        view
        returns (HaggleConditionalSettlement.ReleaseParams memory)
    {
        return HaggleConditionalSettlement.ReleaseParams({
            settlementId: settlementId,
            sellerWallet: seller,
            feeWallet: feeWallet,
            sellerAmount: sellerAmount,
            feeAmount: feeAmount,
            deadline: block.timestamp + 1 hours,
            signerNonce: settlement.signerNonce()
        });
    }

    function _refundParams(bytes32 settlementId)
        internal
        view
        returns (HaggleConditionalSettlement.RefundParams memory)
    {
        return HaggleConditionalSettlement.RefundParams({
            settlementId: settlementId, deadline: block.timestamp + 1 hours, signerNonce: settlement.signerNonce()
        });
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
            settlementId: settlementId, deadline: block.timestamp + 1 hours, signerNonce: settlement.signerNonce()
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

    function test_constructorRejectsZeroSigner() public {
        vm.expectRevert(HaggleConditionalSettlement.ZeroAddress.selector);
        new HaggleConditionalSettlement(owner, address(0));
    }

    function test_contractSignerCanAuthorizeFundingThroughEip1271() public {
        MockConditionalSettlementSigner contractSigner = new MockConditionalSettlementSigner();
        vm.prank(owner);
        settlement.setSigner(address(contractSigner));

        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        contractSigner.approveDigest(_typedDataDigest(_createStructHash(p)));

        vm.startPrank(buyer);
        usdc.approve(address(settlement), grossAmount);
        settlement.createAndFund(p, hex"c0ffee");
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(settlement)), grossAmount);
    }

    function test_revert_createAndFund_zeroBuyer() public {
        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        p.buyer = address(0);
        bytes memory sig = _signCreate(SIGNER_PK, p);

        vm.prank(address(0));
        vm.expectRevert(HaggleConditionalSettlement.ZeroAddress.selector);
        settlement.createAndFund(p, sig);
    }

    function test_revert_createAndFund_zeroSeller() public {
        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        p.seller = address(0);
        bytes memory sig = _signCreate(SIGNER_PK, p);

        vm.prank(buyer);
        vm.expectRevert(HaggleConditionalSettlement.ZeroAddress.selector);
        settlement.createAndFund(p, sig);
    }

    function test_revert_createAndFund_zeroAsset() public {
        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        p.asset = address(0);
        bytes memory sig = _signCreate(SIGNER_PK, p);

        vm.prank(buyer);
        vm.expectRevert(HaggleConditionalSettlement.ZeroAddress.selector);
        settlement.createAndFund(p, sig);
    }

    function test_revert_createAndFund_buyerEqualsSeller() public {
        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        p.seller = buyer;
        bytes memory sig = _signCreate(SIGNER_PK, p);

        vm.prank(buyer);
        vm.expectRevert(HaggleConditionalSettlement.BuyerIsSeller.selector);
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
            settlementId: settlementId, deadline: block.timestamp + 1 hours, signerNonce: settlement.signerNonce()
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
            uint8(settlement.settlementState(settlementId)), uint8(HaggleConditionalSettlement.SettlementState.RELEASED)
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

    function test_createAndFund_atExactExpiryBoundary() public {
        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        p.expiresAt = block.timestamp;
        bytes memory sig = _signCreate(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(settlement), grossAmount);
        settlement.createAndFund(p, sig);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(settlement)), grossAmount);
    }

    function test_revert_createAndFund_afterExpiry() public {
        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        bytes memory sig = _signCreate(SIGNER_PK, p);
        vm.warp(p.expiresAt + 1);

        vm.startPrank(buyer);
        usdc.approve(address(settlement), grossAmount);
        vm.expectRevert(HaggleConditionalSettlement.DeadlineExpired.selector);
        settlement.createAndFund(p, sig);
        vm.stopPrank();
    }

    function test_revert_createAndFund_duplicateSignedRequest() public {
        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        bytes memory sig = _signCreate(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(settlement), grossAmount * 2);
        settlement.createAndFund(p, sig);
        vm.expectRevert(HaggleConditionalSettlement.SettlementAlreadyExists.selector);
        settlement.createAndFund(p, sig);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(settlement)), grossAmount);
    }

    function test_revert_createAndFund_wrongSignerNonce() public {
        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        p.signerNonce += 1;
        bytes memory sig = _signCreate(SIGNER_PK, p);

        vm.prank(buyer);
        vm.expectRevert(HaggleConditionalSettlement.SignerNonceMismatch.selector);
        settlement.createAndFund(p, sig);
    }

    function test_revert_createAndFund_disallowedAsset() public {
        vm.prank(owner);
        settlement.disallowAsset(address(usdc));
        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        bytes memory sig = _signCreate(SIGNER_PK, p);

        vm.prank(buyer);
        vm.expectRevert(HaggleConditionalSettlement.AssetNotAllowed.selector);
        settlement.createAndFund(p, sig);
    }

    function test_revert_createAndFund_amountBelowMinimum() public {
        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        p.grossAmount = settlement.MIN_GROSS_AMOUNT() - 1;
        bytes memory sig = _signCreate(SIGNER_PK, p);

        vm.prank(buyer);
        vm.expectRevert(HaggleConditionalSettlement.AmountTooLow.selector);
        settlement.createAndFund(p, sig);
    }

    function test_revert_createAndFund_insufficientAllowanceLeavesNoRecord() public {
        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        bytes32 settlementId = settlement.computeSettlementId(p);
        bytes memory sig = _signCreate(SIGNER_PK, p);

        vm.prank(buyer);
        vm.expectRevert();
        settlement.createAndFund(p, sig);

        assertEq(
            uint8(settlement.settlementState(settlementId)), uint8(HaggleConditionalSettlement.SettlementState.NONE)
        );
        assertEq(usdc.balanceOf(address(settlement)), 0);
    }

    function test_revert_release_amountMismatch() public {
        bytes32 settlementId = _fund();
        HaggleConditionalSettlement.ReleaseParams memory p = _releaseParams(settlementId);
        p.sellerAmount -= 1;
        bytes memory sig = _signRelease(SIGNER_PK, p);

        vm.expectRevert(HaggleConditionalSettlement.AmountMismatch.selector);
        settlement.release(p, sig);
    }

    function test_release_feeAtExactCap() public {
        bytes32 settlementId = _fund();
        HaggleConditionalSettlement.ReleaseParams memory p = _releaseParams(settlementId);
        p.feeAmount = grossAmount * settlement.MAX_FEE_BPS() / 10_000;
        p.sellerAmount = grossAmount - p.feeAmount;

        settlement.release(p, _signRelease(SIGNER_PK, p));

        assertEq(usdc.balanceOf(feeWallet), p.feeAmount);
        assertEq(usdc.balanceOf(seller), p.sellerAmount);
    }

    function test_release_zeroFeeAllowsZeroFeeWallet() public {
        bytes32 settlementId = _fund();
        HaggleConditionalSettlement.ReleaseParams memory p = _releaseParams(settlementId);
        p.sellerAmount = grossAmount;
        p.feeAmount = 0;
        p.feeWallet = address(0);

        settlement.release(p, _signRelease(SIGNER_PK, p));

        assertEq(usdc.balanceOf(seller), grossAmount);
        assertEq(usdc.balanceOf(address(settlement)), 0);
    }

    function test_revert_release_nonZeroFeeRequiresFeeWallet() public {
        bytes32 settlementId = _fund();
        HaggleConditionalSettlement.ReleaseParams memory p = _releaseParams(settlementId);
        p.feeWallet = address(0);
        bytes memory sig = _signRelease(SIGNER_PK, p);

        vm.expectRevert(HaggleConditionalSettlement.ZeroAddress.selector);
        settlement.release(p, sig);
    }

    function test_revert_release_recipientCannotBeSettlementContract() public {
        bytes32 settlementId = _fund();
        HaggleConditionalSettlement.ReleaseParams memory p = _releaseParams(settlementId);
        p.feeWallet = address(settlement);
        bytes memory sig = _signRelease(SIGNER_PK, p);

        vm.expectRevert(HaggleConditionalSettlement.RecipientIsContract.selector);
        settlement.release(p, sig);
    }

    function test_revert_release_invalidSignatureLeavesFundsLocked() public {
        bytes32 settlementId = _fund();
        HaggleConditionalSettlement.ReleaseParams memory p = _releaseParams(settlementId);
        bytes memory attackerSignature = _signRelease(0xBAD, p);

        vm.expectRevert(HaggleConditionalSettlement.InvalidSignature.selector);
        settlement.release(p, attackerSignature);
        assertEq(usdc.balanceOf(address(settlement)), grossAmount);
    }

    function test_revert_release_wrongSignerNonce() public {
        bytes32 settlementId = _fund();
        HaggleConditionalSettlement.ReleaseParams memory p = _releaseParams(settlementId);
        p.signerNonce += 1;
        bytes memory sig = _signRelease(SIGNER_PK, p);

        vm.expectRevert(HaggleConditionalSettlement.SignerNonceMismatch.selector);
        settlement.release(p, sig);
    }

    function test_revert_release_expiredSignature() public {
        bytes32 settlementId = _fund();
        HaggleConditionalSettlement.ReleaseParams memory p = _releaseParams(settlementId);
        bytes memory sig = _signRelease(SIGNER_PK, p);
        vm.warp(p.deadline + 1);

        vm.expectRevert(HaggleConditionalSettlement.DeadlineExpired.selector);
        settlement.release(p, sig);
    }

    function test_revert_releaseTwice() public {
        bytes32 settlementId = _fund();
        HaggleConditionalSettlement.ReleaseParams memory p = _releaseParams(settlementId);
        bytes memory sig = _signRelease(SIGNER_PK, p);
        settlement.release(p, sig);

        vm.expectRevert(HaggleConditionalSettlement.SettlementFinalized.selector);
        settlement.release(p, sig);
    }

    function test_revert_refundAfterRelease() public {
        bytes32 settlementId = _fund();
        HaggleConditionalSettlement.ReleaseParams memory releaseParams = _releaseParams(settlementId);
        settlement.release(releaseParams, _signRelease(SIGNER_PK, releaseParams));
        HaggleConditionalSettlement.RefundParams memory refundParams = _refundParams(settlementId);
        bytes memory refundSignature = _signRefund(SIGNER_PK, refundParams);

        vm.expectRevert(HaggleConditionalSettlement.SettlementFinalized.selector);
        settlement.refund(refundParams, refundSignature);
    }

    function test_revert_refund_expiredSignature() public {
        bytes32 settlementId = _fund();
        HaggleConditionalSettlement.RefundParams memory p = _refundParams(settlementId);
        bytes memory sig = _signRefund(SIGNER_PK, p);
        vm.warp(p.deadline + 1);

        vm.expectRevert(HaggleConditionalSettlement.DeadlineExpired.selector);
        settlement.refund(p, sig);
    }

    function test_revert_refund_invalidSignatureLeavesFundsLocked() public {
        bytes32 settlementId = _fund();
        HaggleConditionalSettlement.RefundParams memory p = _refundParams(settlementId);
        bytes memory attackerSignature = _signRefund(0xBAD, p);

        vm.expectRevert(HaggleConditionalSettlement.InvalidSignature.selector);
        settlement.refund(p, attackerSignature);
        assertEq(usdc.balanceOf(address(settlement)), grossAmount);
    }

    function test_revert_refund_wrongSignerNonce() public {
        bytes32 settlementId = _fund();
        HaggleConditionalSettlement.RefundParams memory p = _refundParams(settlementId);
        p.signerNonce += 1;
        bytes memory sig = _signRefund(SIGNER_PK, p);

        vm.expectRevert(HaggleConditionalSettlement.SignerNonceMismatch.selector);
        settlement.refund(p, sig);
    }

    function test_revert_unknownSettlementCannotReleaseRefundExpireOrDispute() public {
        bytes32 unknownId = keccak256("unknown-settlement");
        HaggleConditionalSettlement.ReleaseParams memory releaseParams = _releaseParams(unknownId);
        HaggleConditionalSettlement.RefundParams memory refundParams = _refundParams(unknownId);
        bytes memory releaseSig = _signRelease(SIGNER_PK, releaseParams);
        bytes memory refundSig = _signRefund(SIGNER_PK, refundParams);

        vm.expectRevert(HaggleConditionalSettlement.SettlementNotFunded.selector);
        settlement.release(releaseParams, releaseSig);
        vm.expectRevert(HaggleConditionalSettlement.SettlementNotFunded.selector);
        settlement.refund(refundParams, refundSig);
        vm.expectRevert(HaggleConditionalSettlement.SettlementNotFunded.selector);
        settlement.expire(unknownId);
        vm.expectRevert(HaggleConditionalSettlement.SettlementNotFunded.selector);
        settlement.raiseDispute(unknownId, keccak256("evidence"));
    }

    function test_expire_atExactBoundaryStillLocked() public {
        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        bytes32 settlementId = _fund();
        vm.warp(p.expiresAt);

        vm.expectRevert(HaggleConditionalSettlement.SettlementNotExpired.selector);
        settlement.expire(settlementId);
        assertEq(usdc.balanceOf(address(settlement)), grossAmount);
    }

    function test_anyoneCanTriggerBuyerProtectiveExpiry() public {
        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        bytes32 settlementId = _fund();
        vm.warp(p.expiresAt + 1);

        vm.prank(attacker);
        settlement.expire(settlementId);

        assertEq(usdc.balanceOf(buyer), 1_000_000_000);
    }

    function test_revert_nonParticipantCannotRaiseDispute() public {
        bytes32 settlementId = _fund();

        vm.prank(attacker);
        vm.expectRevert(HaggleConditionalSettlement.CallerNotParticipant.selector);
        settlement.raiseDispute(settlementId, keccak256("fake-evidence"));
    }

    function test_sellerCanRaiseDispute() public {
        bytes32 settlementId = _fund();

        vm.prank(seller);
        settlement.raiseDispute(settlementId, keccak256("seller-evidence"));

        assertEq(
            uint8(settlement.settlementState(settlementId)), uint8(HaggleConditionalSettlement.SettlementState.DISPUTED)
        );
    }

    function test_signerRotationInvalidatesOutstandingCreateSignature() public {
        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        bytes memory staleSignature = _signCreate(SIGNER_PK, p);
        address newSigner = vm.addr(0xC0FFEE);

        vm.prank(owner);
        settlement.setSigner(newSigner);

        vm.prank(buyer);
        vm.expectRevert(HaggleConditionalSettlement.SignerNonceMismatch.selector);
        settlement.createAndFund(p, staleSignature);
    }

    function test_disallowingAssetAfterFundingDoesNotStrandBuyerRefund() public {
        bytes32 settlementId = _fund();
        vm.prank(owner);
        settlement.disallowAsset(address(usdc));
        HaggleConditionalSettlement.RefundParams memory p = _refundParams(settlementId);

        settlement.refund(p, _signRefund(SIGNER_PK, p));

        assertEq(usdc.balanceOf(buyer), 1_000_000_000);
        assertEq(usdc.balanceOf(address(settlement)), 0);
    }

    function test_pauseBlocksFundingAndUnpauseRestoresIt() public {
        vm.prank(owner);
        settlement.pause();
        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        bytes memory sig = _signCreate(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(settlement), grossAmount);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        settlement.createAndFund(p, sig);
        vm.stopPrank();

        vm.prank(owner);
        settlement.unpause();
        vm.prank(buyer);
        settlement.createAndFund(p, sig);
        assertEq(usdc.balanceOf(address(settlement)), grossAmount);
    }

    function test_pauseAlsoBlocksBuyerProtectiveExpiry() public {
        HaggleConditionalSettlement.ConditionalSettlementParams memory p = _defaultParams();
        bytes32 settlementId = _fund();
        vm.warp(p.expiresAt + 1);
        vm.prank(owner);
        settlement.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        settlement.expire(settlementId);
        assertEq(usdc.balanceOf(address(settlement)), grossAmount);
    }

    function test_pauseBlocksSignedReleaseAndRefund() public {
        bytes32 settlementId = _fund();
        HaggleConditionalSettlement.ReleaseParams memory releaseParams = _releaseParams(settlementId);
        HaggleConditionalSettlement.RefundParams memory refundParams = _refundParams(settlementId);
        bytes memory releaseSig = _signRelease(SIGNER_PK, releaseParams);
        bytes memory refundSig = _signRefund(SIGNER_PK, refundParams);
        vm.prank(owner);
        settlement.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        settlement.release(releaseParams, releaseSig);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        settlement.refund(refundParams, refundSig);
        assertEq(usdc.balanceOf(address(settlement)), grossAmount);
    }
}
