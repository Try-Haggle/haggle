// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../sol/HaggleConditionalSettlement.sol";
import "../sol/HaggleTestUSDC.sol";

/// @notice Read-only fork rehearsal against the tracked Base Sepolia deployment.
/// @dev All mutations happen in Foundry's local fork and are never broadcast to Base Sepolia.
contract HaggleConditionalSettlementBaseSepoliaTest is Test {
    HaggleConditionalSettlement constant DEPLOYED_SETTLEMENT =
        HaggleConditionalSettlement(0x47228b3B82E3baEF46722aC9475eBfd49Da22a7B);
    HaggleTestUSDC constant DEPLOYED_HUSDC = HaggleTestUSDC(0x579807433033757E895437EEfa9Ae25F387c3fCa);

    address constant EXPECTED_OWNER = 0xAf697e64cA951488E82FDef2FA179D1797DD02D3;
    address constant EXPECTED_SIGNER = 0x9E30b35dE319C75f034Ba8ddEc732A130d9D58e5;
    uint256 constant TEST_SIGNER_PK = 0xA11CE;
    uint256 constant GROSS_AMOUNT = 10_000_000;
    uint256 constant SELLER_AMOUNT = 9_850_000;
    uint256 constant FEE_AMOUNT = 150_000;

    bool forkReady;
    address buyer = makeAddr("fork-buyer");
    address seller = makeAddr("fork-seller");
    address feeWallet = makeAddr("fork-fee-wallet");
    address relayer = makeAddr("fork-relayer");

    modifier onBaseSepoliaFork() {
        vm.skip(!forkReady, "BASE_SEPOLIA_RPC_URL is not configured");
        _;
    }

    function setUp() public {
        string memory rpcUrl = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);
        forkReady = true;
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("HaggleConditionalSettlement"),
                keccak256("1"),
                block.chainid,
                address(DEPLOYED_SETTLEMENT)
            )
        );
    }

    function _sign(uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signCreate(HaggleConditionalSettlement.ConditionalSettlementParams memory p)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                DEPLOYED_SETTLEMENT.CONDITIONAL_SETTLEMENT_TYPEHASH(),
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
        return _sign(TEST_SIGNER_PK, structHash);
    }

    function _signRelease(HaggleConditionalSettlement.ReleaseParams memory p) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                DEPLOYED_SETTLEMENT.RELEASE_TYPEHASH(),
                p.settlementId,
                p.sellerWallet,
                p.feeWallet,
                p.sellerAmount,
                p.feeAmount,
                p.deadline,
                p.signerNonce
            )
        );
        return _sign(TEST_SIGNER_PK, structHash);
    }

    function _signRefund(HaggleConditionalSettlement.RefundParams memory p) internal view returns (bytes memory) {
        bytes32 structHash =
            keccak256(abi.encode(DEPLOYED_SETTLEMENT.REFUND_TYPEHASH(), p.settlementId, p.deadline, p.signerNonce));
        return _sign(TEST_SIGNER_PK, structHash);
    }

    function _configureForkSignerAndBuyer() internal {
        vm.prank(EXPECTED_OWNER);
        DEPLOYED_SETTLEMENT.setSigner(vm.addr(TEST_SIGNER_PK));
        vm.prank(EXPECTED_OWNER);
        DEPLOYED_HUSDC.mint(buyer, GROSS_AMOUNT * 4);
    }

    function _fund(bytes32 salt) internal returns (bytes32 settlementId) {
        HaggleConditionalSettlement.ConditionalSettlementParams memory p =
            HaggleConditionalSettlement.ConditionalSettlementParams({
                orderId: keccak256(abi.encode("fork-order", salt)),
                paymentIntentId: keccak256(abi.encode("fork-payment", salt)),
                approvalPolicyHash: keccak256(abi.encode("fork-policy", salt)),
                agreementHash: keccak256(abi.encode("fork-agreement", salt)),
                listingHash: keccak256(abi.encode("fork-listing", salt)),
                grantNonce: keccak256(abi.encode("fork-grant", salt)),
                buyer: buyer,
                seller: seller,
                asset: address(DEPLOYED_HUSDC),
                grossAmount: GROSS_AMOUNT,
                expiresAt: block.timestamp + 1 days,
                signerNonce: DEPLOYED_SETTLEMENT.signerNonce()
            });
        settlementId = DEPLOYED_SETTLEMENT.computeSettlementId(p);
        bytes memory signature = _signCreate(p);

        vm.startPrank(buyer);
        DEPLOYED_HUSDC.approve(address(DEPLOYED_SETTLEMENT), GROSS_AMOUNT);
        DEPLOYED_SETTLEMENT.createAndFund(p, signature);
        vm.stopPrank();
    }

    function test_deployedConfigurationMatchesTrackedManifest() public onBaseSepoliaFork {
        assertEq(block.chainid, 84532);
        assertGt(address(DEPLOYED_SETTLEMENT).code.length, 0);
        assertGt(address(DEPLOYED_HUSDC).code.length, 0);
        assertEq(DEPLOYED_SETTLEMENT.owner(), EXPECTED_OWNER);
        assertEq(DEPLOYED_SETTLEMENT.signer(), EXPECTED_SIGNER);
        assertFalse(DEPLOYED_SETTLEMENT.paused());
        assertTrue(DEPLOYED_SETTLEMENT.allowedAssets(address(DEPLOYED_HUSDC)));
        assertEq(DEPLOYED_HUSDC.owner(), EXPECTED_OWNER);
        assertEq(DEPLOYED_HUSDC.symbol(), "hUSDC");
        assertEq(DEPLOYED_HUSDC.decimals(), 6);
    }

    function test_deployedCode_fundsAndReleasesWithExactSplit() public onBaseSepoliaFork {
        _configureForkSignerAndBuyer();
        uint256 escrowBalanceBefore = DEPLOYED_HUSDC.balanceOf(address(DEPLOYED_SETTLEMENT));
        uint256 sellerBalanceBefore = DEPLOYED_HUSDC.balanceOf(seller);
        uint256 feeBalanceBefore = DEPLOYED_HUSDC.balanceOf(feeWallet);
        bytes32 settlementId = _fund(keccak256("release"));
        HaggleConditionalSettlement.ReleaseParams memory p = HaggleConditionalSettlement.ReleaseParams({
            settlementId: settlementId,
            sellerWallet: seller,
            feeWallet: feeWallet,
            sellerAmount: SELLER_AMOUNT,
            feeAmount: FEE_AMOUNT,
            deadline: block.timestamp + 1 hours,
            signerNonce: DEPLOYED_SETTLEMENT.signerNonce()
        });

        bytes memory signature = _signRelease(p);
        vm.prank(relayer);
        DEPLOYED_SETTLEMENT.release(p, signature);

        assertEq(DEPLOYED_HUSDC.balanceOf(seller), sellerBalanceBefore + SELLER_AMOUNT);
        assertEq(DEPLOYED_HUSDC.balanceOf(feeWallet), feeBalanceBefore + FEE_AMOUNT);
        assertEq(DEPLOYED_HUSDC.balanceOf(address(DEPLOYED_SETTLEMENT)), escrowBalanceBefore);
    }

    function test_deployedCode_signedRefundReturnsFullAmount() public onBaseSepoliaFork {
        _configureForkSignerAndBuyer();
        uint256 buyerBalanceBefore = DEPLOYED_HUSDC.balanceOf(buyer);
        uint256 escrowBalanceBefore = DEPLOYED_HUSDC.balanceOf(address(DEPLOYED_SETTLEMENT));
        bytes32 settlementId = _fund(keccak256("refund"));
        HaggleConditionalSettlement.RefundParams memory p = HaggleConditionalSettlement.RefundParams({
            settlementId: settlementId,
            deadline: block.timestamp + 1 hours,
            signerNonce: DEPLOYED_SETTLEMENT.signerNonce()
        });

        bytes memory signature = _signRefund(p);
        vm.prank(relayer);
        DEPLOYED_SETTLEMENT.refund(p, signature);

        assertEq(DEPLOYED_HUSDC.balanceOf(buyer), buyerBalanceBefore);
        assertEq(DEPLOYED_HUSDC.balanceOf(address(DEPLOYED_SETTLEMENT)), escrowBalanceBefore);
    }

    function test_deployedCode_disputeLocksThenSignedRefundResolves() public onBaseSepoliaFork {
        _configureForkSignerAndBuyer();
        uint256 escrowBalanceBefore = DEPLOYED_HUSDC.balanceOf(address(DEPLOYED_SETTLEMENT));
        bytes32 settlementId = _fund(keccak256("dispute-refund"));

        vm.prank(buyer);
        DEPLOYED_SETTLEMENT.raiseDispute(settlementId, keccak256("fork-evidence"));
        assertEq(DEPLOYED_HUSDC.balanceOf(address(DEPLOYED_SETTLEMENT)), escrowBalanceBefore + GROSS_AMOUNT);

        HaggleConditionalSettlement.RefundParams memory p = HaggleConditionalSettlement.RefundParams({
            settlementId: settlementId,
            deadline: block.timestamp + 1 hours,
            signerNonce: DEPLOYED_SETTLEMENT.signerNonce()
        });
        bytes memory signature = _signRefund(p);
        vm.prank(relayer);
        DEPLOYED_SETTLEMENT.refund(p, signature);

        assertEq(DEPLOYED_HUSDC.balanceOf(address(DEPLOYED_SETTLEMENT)), escrowBalanceBefore);
        assertEq(
            uint8(DEPLOYED_SETTLEMENT.settlementState(settlementId)),
            uint8(HaggleConditionalSettlement.SettlementState.REFUNDED)
        );
    }

    function test_deployedCode_expiryIsPermissionlessAndBuyerProtective() public onBaseSepoliaFork {
        _configureForkSignerAndBuyer();
        uint256 buyerBalanceBefore = DEPLOYED_HUSDC.balanceOf(buyer);
        uint256 escrowBalanceBefore = DEPLOYED_HUSDC.balanceOf(address(DEPLOYED_SETTLEMENT));
        bytes32 settlementId = _fund(keccak256("expiry"));
        vm.warp(block.timestamp + 2 days);

        vm.prank(relayer);
        DEPLOYED_SETTLEMENT.expire(settlementId);

        assertEq(DEPLOYED_HUSDC.balanceOf(buyer), buyerBalanceBefore);
        assertEq(DEPLOYED_HUSDC.balanceOf(address(DEPLOYED_SETTLEMENT)), escrowBalanceBefore);
    }
}
