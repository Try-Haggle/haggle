// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../sol/HaggleSettlementRouter.sol";
import "./MockUSDC.sol";

contract HaggleSettlementRouterTest is Test {
    HaggleSettlementRouter public router;
    MockUSDC public usdc;

    uint256 constant SIGNER_PK = 0xA11CE;
    address signerAddr;

    address buyer = makeAddr("buyer");
    address seller = makeAddr("seller");
    address sellerWallet = makeAddr("sellerWallet");
    address feeWallet = makeAddr("feeWallet");
    address owner = makeAddr("owner");
    address attacker = makeAddr("attacker");
    address guardianAddr = makeAddr("guardian");

    bytes32 orderId = keccak256("order-1");
    bytes32 paymentIntentId = keccak256("pi-1");

    uint256 grossAmount = 100_000_000; // $100 USDC (6 decimals)
    uint256 sellerAmount = 98_500_000;
    uint256 feeAmount = 1_500_000;     // 1.5% fee (within 10% cap)

    function setUp() public {
        signerAddr = vm.addr(SIGNER_PK);

        vm.startPrank(owner);
        router = new HaggleSettlementRouter(owner, signerAddr);
        usdc = new MockUSDC();
        router.allowAsset(address(usdc));
        router.setGuardian(guardianAddr);
        vm.stopPrank();

        usdc.mint(buyer, 1_000_000_000);
    }

    // ─── Helpers ─────────────────────────────────────────────

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("HaggleSettlementRouter"),
            keccak256("1"),
            block.chainid,
            address(router)
        ));
    }

    function _signParams(uint256 pk, HaggleSettlementRouter.SettlementParams memory p) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            router.SETTLEMENT_TYPEHASH(),
            p.orderId, p.paymentIntentId, p.buyer, p.seller, p.sellerWallet,
            p.feeWallet, p.asset, p.grossAmount, p.sellerAmount, p.feeAmount,
            p.deadline, p.signerNonce
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _defaultParams() internal view returns (HaggleSettlementRouter.SettlementParams memory) {
        return HaggleSettlementRouter.SettlementParams({
            orderId: orderId,
            paymentIntentId: paymentIntentId,
            buyer: buyer,
            seller: seller,
            sellerWallet: sellerWallet,
            feeWallet: feeWallet,
            asset: address(usdc),
            grossAmount: grossAmount,
            sellerAmount: sellerAmount,
            feeAmount: feeAmount,
            deadline: block.timestamp + 1 hours,
            signerNonce: router.signerNonce()
        });
    }

    function _defaultSig() internal view returns (bytes memory) {
        return _signParams(SIGNER_PK, _defaultParams());
    }

    function _doSettle(bytes32 _orderId) internal returns (bytes32) {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.orderId = _orderId;
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        bytes32 execId = router.executeSettlement(p, sig);
        vm.stopPrank();
        return execId;
    }

    // ─── Deployment ─────────────────────────────────────────

    function test_deployment_setsOwner() public view {
        assertEq(router.owner(), owner);
    }

    function test_deployment_setsSigner() public view {
        assertEq(router.signer(), signerAddr);
    }

    function test_deployment_notPaused() public view {
        assertFalse(router.paused());
    }

    function test_deployment_usesOwnable2Step() public view {
        assertEq(router.pendingOwner(), address(0));
    }

    function test_deployment_signerNonceStartsAtZero() public view {
        assertEq(router.signerNonce(), 0);
    }

    function test_deployment_emitsSignerUpdated() public {
        vm.expectEmit(true, true, false, false);
        emit HaggleSettlementRouter.SignerUpdated(address(0), signerAddr);
        vm.prank(owner);
        new HaggleSettlementRouter(owner, signerAddr);
    }

    function test_revert_deployment_zeroSigner() public {
        vm.prank(owner);
        vm.expectRevert(HaggleSettlementRouter.ZeroAddress.selector);
        new HaggleSettlementRouter(owner, address(0));
    }

    // ─── Constants ──────────────────────────────────────────

    function test_constants() public view {
        assertEq(router.MAX_FEE_BPS(), 1000);
        assertEq(router.MIN_GROSS_AMOUNT(), 1e4);
        assertEq(router.SIGNER_ROTATION_DELAY(), 48 hours);
    }

    // ─── renounceOwnership disabled ─────────────────────────

    function test_revert_renounceOwnership() public {
        vm.prank(owner);
        vm.expectRevert("disabled");
        router.renounceOwnership();
    }

    // ─── executeSettlement: happy path ──────────────────────

    function test_executeSettlement_transfersCorrectly() public {
        _doSettle(orderId);

        assertEq(usdc.balanceOf(sellerWallet), sellerAmount);
        assertEq(usdc.balanceOf(feeWallet), feeAmount);
        assertEq(usdc.balanceOf(buyer), 1_000_000_000 - grossAmount);
    }

    function test_executeSettlement_emitsEvent() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);

        vm.expectEmit(false, true, false, true);
        emit HaggleSettlementRouter.SettlementExecuted(
            bytes32(0), orderId, paymentIntentId,
            buyer, seller, sellerWallet, feeWallet, address(usdc),
            grossAmount, sellerAmount, feeAmount
        );

        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    function test_executeSettlement_returnsUniqueExecutionId() public {
        bytes32 id1 = _doSettle(orderId);
        bytes32 id2 = _doSettle(keccak256("order-2"));

        assertTrue(id1 != id2);
        assertTrue(id1 != bytes32(0));
    }

    function test_executeSettlement_deterministicId() public {
        bytes32 expected = keccak256(abi.encode(orderId, paymentIntentId, block.chainid));
        bytes32 execId = _doSettle(orderId);
        assertEq(execId, expected);
    }

    function test_executeSettlement_marksOrderAsSettled() public {
        _doSettle(orderId);
        assertTrue(router.settledOrders(orderId));
    }

    // ─── executeSettlement: zero fee ────────────────────────

    function test_executeSettlement_zeroFee() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.sellerAmount = grossAmount;
        p.feeAmount = 0;
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        router.executeSettlement(p, sig);
        vm.stopPrank();

        assertEq(usdc.balanceOf(sellerWallet), grossAmount);
        assertEq(usdc.balanceOf(feeWallet), 0);
    }

    // ─── Deadline ───────────────────────────────────────────

    function test_revert_deadlineExpired() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.deadline = block.timestamp - 1;
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        vm.expectRevert(HaggleSettlementRouter.DeadlineExpired.selector);
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    function test_deadlineAtExactTimestamp() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.deadline = block.timestamp; // exactly now, not expired
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        router.executeSettlement(p, sig);
        vm.stopPrank();

        assertEq(usdc.balanceOf(sellerWallet), sellerAmount);
    }

    // ─── Signer Nonce ───────────────────────────────────────

    function test_revert_signerNonceMismatch() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.signerNonce = 999;
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        vm.expectRevert(HaggleSettlementRouter.SignerNonceMismatch.selector);
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    // ─── Fee Cap ────────────────────────────────────────────

    function test_revert_feeTooHigh() public {
        // 11% fee > MAX_FEE_BPS (10%)
        uint256 _grossAmount = 100_000_000;
        uint256 _feeAmount = 11_000_000; // 11%
        uint256 _sellerAmount = _grossAmount - _feeAmount;

        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.grossAmount = _grossAmount;
        p.sellerAmount = _sellerAmount;
        p.feeAmount = _feeAmount;
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), _grossAmount);
        vm.expectRevert(HaggleSettlementRouter.FeeTooHigh.selector);
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    function test_feeAtExactCap() public {
        // Exactly 10% fee = MAX_FEE_BPS (1000 bps)
        uint256 _grossAmount = 100_000_000;
        uint256 _feeAmount = 10_000_000; // exactly 10%
        uint256 _sellerAmount = _grossAmount - _feeAmount;

        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.grossAmount = _grossAmount;
        p.sellerAmount = _sellerAmount;
        p.feeAmount = _feeAmount;
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), _grossAmount);
        router.executeSettlement(p, sig);
        vm.stopPrank();

        assertEq(usdc.balanceOf(feeWallet), _feeAmount);
    }

    // ─── Min/Max Amount ─────────────────────────────────────

    function test_revert_amountTooLow() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.grossAmount = router.MIN_GROSS_AMOUNT() - 1;
        p.sellerAmount = p.grossAmount;
        p.feeAmount = 0;
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), p.grossAmount);
        vm.expectRevert(HaggleSettlementRouter.AmountTooLow.selector);
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    function test_revert_amountTooHigh() public {
        vm.prank(owner);
        router.setMaxSettlementAmount(50_000_000); // $50 cap

        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        vm.expectRevert(HaggleSettlementRouter.AmountTooHigh.selector);
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    function test_maxSettlementAmount_zeroMeansNoCap() public {
        assertEq(router.maxSettlementAmount(), 0);
        // Should settle any amount without cap
        _doSettle(orderId);
        assertEq(usdc.balanceOf(sellerWallet), sellerAmount);
    }

    function test_setMaxSettlementAmount_emitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(false, false, false, true);
        emit HaggleSettlementRouter.MaxSettlementAmountUpdated(0, 50_000_000);
        router.setMaxSettlementAmount(50_000_000);
    }

    // ─── Recipient is Router ────────────────────────────────

    function test_revert_sellerWalletIsRouter() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.sellerWallet = address(router);
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        vm.expectRevert(HaggleSettlementRouter.RecipientIsRouter.selector);
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    function test_revert_feeWalletIsRouter() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.feeWallet = address(router);
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        vm.expectRevert(HaggleSettlementRouter.RecipientIsRouter.selector);
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    // ─── EIP-712 signature verification ─────────────────────

    function test_revert_invalidSignature() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        bytes memory badSig = _signParams(0xBAD, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        vm.expectRevert(HaggleSettlementRouter.InvalidSignature.selector);
        router.executeSettlement(p, badSig);
        vm.stopPrank();
    }

    function test_revert_tamperedParams() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        bytes memory sig = _signParams(SIGNER_PK, p);

        p.sellerAmount = 1;
        p.feeAmount = grossAmount - 1;

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        // Will revert with FeeTooHigh or InvalidSignature depending on check order
        vm.expectRevert();
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    function test_revert_tamperedFeeWallet() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        bytes memory sig = _signParams(SIGNER_PK, p);

        p.feeWallet = makeAddr("attackerWallet");

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        vm.expectRevert(HaggleSettlementRouter.InvalidSignature.selector);
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    // ─── Two-Phase Signer Rotation ──────────────────────────

    function test_proposeSigner_setsPending() public {
        address newSigner = makeAddr("newSigner");
        vm.prank(owner);
        router.proposeSigner(newSigner);

        assertEq(router.pendingSigner(), newSigner);
        assertTrue(router.signerRotationReadyAt() > block.timestamp);
    }

    function test_proposeSigner_emitsEvent() public {
        address newSigner = makeAddr("newSigner");
        uint256 expectedReadyAt = block.timestamp + router.SIGNER_ROTATION_DELAY();

        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit HaggleSettlementRouter.SignerRotationProposed(newSigner, expectedReadyAt);
        router.proposeSigner(newSigner);
    }

    function test_revert_proposeSigner_zeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(HaggleSettlementRouter.ZeroAddress.selector);
        router.proposeSigner(address(0));
    }

    function test_revert_proposeSigner_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        router.proposeSigner(attacker);
    }

    function test_revert_confirmSigner_noProposal() public {
        vm.prank(owner);
        vm.expectRevert(HaggleSettlementRouter.NoSignerProposed.selector);
        router.confirmSigner(address(1));
    }

    function test_revert_confirmSigner_tooEarly() public {
        address newSigner = makeAddr("newSigner");
        vm.prank(owner);
        router.proposeSigner(newSigner);

        vm.prank(owner);
        vm.expectRevert(HaggleSettlementRouter.RotationTooEarly.selector);
        router.confirmSigner(newSigner);
    }

    function test_revert_confirmSigner_mismatch() public {
        address newSigner = makeAddr("newSigner");
        vm.prank(owner);
        router.proposeSigner(newSigner);
        vm.warp(block.timestamp + router.SIGNER_ROTATION_DELAY());

        vm.prank(owner);
        vm.expectRevert(HaggleSettlementRouter.SignerMismatch.selector);
        router.confirmSigner(makeAddr("wrongSigner"));
    }

    function test_confirmSigner_afterDelay() public {
        uint256 newSignerPk = 0xBEEF;
        address newSigner = vm.addr(newSignerPk);

        vm.prank(owner);
        router.proposeSigner(newSigner);

        vm.warp(block.timestamp + router.SIGNER_ROTATION_DELAY());

        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit HaggleSettlementRouter.SignerUpdated(signerAddr, newSigner);
        router.confirmSigner(newSigner);

        assertEq(router.signer(), newSigner);
        assertEq(router.pendingSigner(), address(0));
        assertEq(router.signerRotationReadyAt(), 0);
    }

    function test_confirmSigner_incrementsNonce() public {
        uint256 nonceBefore = router.signerNonce();

        address ns = makeAddr("newSigner");
        vm.prank(owner);
        router.proposeSigner(ns);
        vm.warp(block.timestamp + router.SIGNER_ROTATION_DELAY());
        vm.prank(owner);
        router.confirmSigner(ns);

        assertEq(router.signerNonce(), nonceBefore + 1);
    }

    function test_oldSignerInvalidAfterRotation() public {
        // Sign with old signer and old nonce, with long deadline to survive warp
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.deadline = block.timestamp + 7 days;
        bytes memory oldSig = _signParams(SIGNER_PK, p);

        // Rotate signer (requires 48h warp)
        uint256 newSignerPk = 0xBEEF;
        address newSigner = vm.addr(newSignerPk);
        vm.prank(owner);
        router.proposeSigner(newSigner);
        vm.warp(block.timestamp + router.SIGNER_ROTATION_DELAY());
        vm.prank(owner);
        router.confirmSigner(newSigner);

        // Old signature is now invalid (signerNonce changed from 0 to 1)
        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        vm.expectRevert(HaggleSettlementRouter.SignerNonceMismatch.selector);
        router.executeSettlement(p, oldSig);
        vm.stopPrank();
    }

    function test_newSignerWorksAfterRotation() public {
        uint256 newSignerPk = 0xBEEF;
        address newSigner = vm.addr(newSignerPk);

        vm.prank(owner);
        router.proposeSigner(newSigner);
        vm.warp(block.timestamp + router.SIGNER_ROTATION_DELAY());
        vm.prank(owner);
        router.confirmSigner(newSigner);

        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        bytes memory sig = _signParams(newSignerPk, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        router.executeSettlement(p, sig);
        vm.stopPrank();

        assertEq(usdc.balanceOf(sellerWallet), sellerAmount);
    }

    function test_cancelSignerRotation() public {
        address newSigner = makeAddr("newSigner");
        vm.prank(owner);
        router.proposeSigner(newSigner);

        vm.prank(owner);
        vm.expectEmit(true, false, false, false);
        emit HaggleSettlementRouter.SignerRotationCancelled(newSigner);
        router.cancelSignerRotation();

        assertEq(router.pendingSigner(), address(0));
        assertEq(router.signerRotationReadyAt(), 0);
        assertEq(router.signer(), signerAddr); // unchanged
    }

    function test_cancelSignerRotation_noopWhenNoPending() public {
        vm.prank(owner);
        router.cancelSignerRotation(); // no revert, no event
        assertEq(router.pendingSigner(), address(0));
    }

    // ─── Order ID squatting prevention ──────────────────────

    function test_revert_orderIdSquatting() public {
        HaggleSettlementRouter.SettlementParams memory p = HaggleSettlementRouter.SettlementParams({
            orderId: orderId,
            paymentIntentId: paymentIntentId,
            buyer: attacker,
            seller: seller,
            sellerWallet: sellerWallet,
            feeWallet: feeWallet,
            asset: address(usdc),
            grossAmount: router.MIN_GROSS_AMOUNT(),
            sellerAmount: router.MIN_GROSS_AMOUNT(),
            feeAmount: 0,
            deadline: block.timestamp + 1 hours,
            signerNonce: router.signerNonce()
        });
        bytes memory attackerSig = _signParams(0xBAD, p);
        usdc.mint(attacker, router.MIN_GROSS_AMOUNT());

        vm.startPrank(attacker);
        usdc.approve(address(router), router.MIN_GROSS_AMOUNT());
        vm.expectRevert(HaggleSettlementRouter.InvalidSignature.selector);
        router.executeSettlement(p, attackerSig);
        vm.stopPrank();

        // Legitimate settlement still works
        _doSettle(orderId);
        assertEq(usdc.balanceOf(sellerWallet), sellerAmount);
    }

    // ─── Caller authorization ───────────────────────────────

    function test_revert_callerNotBuyer() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.prank(buyer);
        usdc.approve(address(router), grossAmount);

        vm.prank(attacker);
        vm.expectRevert(HaggleSettlementRouter.CallerNotBuyer.selector);
        router.executeSettlement(p, sig);
    }

    // ─── Duplicate settlement prevention ────────────────────

    function test_revert_duplicateOrderSettlement() public {
        _doSettle(orderId);

        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        vm.expectRevert(HaggleSettlementRouter.OrderAlreadySettled.selector);
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    // ─── feeWallet zero address ─────────────────────────────

    function test_revert_feeWalletZeroWithNonZeroFee() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.feeWallet = address(0);
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        vm.expectRevert(HaggleSettlementRouter.ZeroAddress.selector);
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    function test_feeWalletZeroAllowedWhenZeroFee() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.feeWallet = address(0);
        p.sellerAmount = grossAmount;
        p.feeAmount = 0;
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        router.executeSettlement(p, sig);
        vm.stopPrank();

        assertEq(usdc.balanceOf(sellerWallet), grossAmount);
    }

    // ─── Asset allowlist ────────────────────────────────────

    function test_revert_assetNotAllowed() public {
        MockUSDC otherToken = new MockUSDC();
        otherToken.mint(buyer, grossAmount);

        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.asset = address(otherToken);
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        otherToken.approve(address(router), grossAmount);
        vm.expectRevert(HaggleSettlementRouter.AssetNotAllowed.selector);
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    function test_allowAsset_works() public {
        MockUSDC otherToken = new MockUSDC();
        vm.prank(owner);
        router.allowAsset(address(otherToken));
        assertTrue(router.allowedAssets(address(otherToken)));
    }

    function test_disallowAsset_works() public {
        vm.prank(owner);
        router.disallowAsset(address(usdc));
        assertFalse(router.allowedAssets(address(usdc)));
    }

    function test_allowAsset_emitsEvent() public {
        MockUSDC otherToken = new MockUSDC();
        vm.prank(owner);
        vm.expectEmit(true, false, false, false);
        emit HaggleSettlementRouter.AssetAllowed(address(otherToken));
        router.allowAsset(address(otherToken));
    }

    function test_allowAsset_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        router.allowAsset(address(usdc));
    }

    function test_revert_allowAsset_zeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(HaggleSettlementRouter.ZeroAddress.selector);
        router.allowAsset(address(0));
    }

    function test_revert_disallowAsset_zeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(HaggleSettlementRouter.ZeroAddress.selector);
        router.disallowAsset(address(0));
    }

    function test_disallowAsset_thenSettleReverts() public {
        vm.prank(owner);
        router.disallowAsset(address(usdc));

        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        vm.expectRevert(HaggleSettlementRouter.AssetNotAllowed.selector);
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    // ─── Validation ─────────────────────────────────────────

    function test_revert_amountMismatch() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.sellerAmount = sellerAmount + 1;
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        vm.expectRevert(HaggleSettlementRouter.AmountMismatch.selector);
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    function test_revert_zeroAddress_buyer() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.buyer = address(0);
        vm.expectRevert(HaggleSettlementRouter.CallerNotBuyer.selector);
        router.executeSettlement(p, "");
    }

    function test_revert_zeroAddress_seller() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.seller = address(0);
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        vm.expectRevert(HaggleSettlementRouter.ZeroAddress.selector);
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    function test_revert_zeroAddress_sellerWallet() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.sellerWallet = address(0);
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        vm.expectRevert(HaggleSettlementRouter.ZeroAddress.selector);
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    function test_revert_zeroAddress_asset() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.asset = address(0);

        vm.prank(buyer);
        vm.expectRevert(HaggleSettlementRouter.ZeroAddress.selector);
        router.executeSettlement(p, "");
    }

    function test_revert_insufficientAllowance() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.prank(buyer);
        vm.expectRevert();
        router.executeSettlement(p, sig);
    }

    function test_revert_insufficientBalance() public {
        address poorBuyer = makeAddr("poorBuyer");
        usdc.mint(poorBuyer, 1_000);

        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.buyer = poorBuyer;
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(poorBuyer);
        usdc.approve(address(router), grossAmount);
        vm.expectRevert();
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    // ─── Edge cases ─────────────────────────────────────────

    function test_sellerWalletEqualsBuyer() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.sellerWallet = buyer;
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        router.executeSettlement(p, sig);
        vm.stopPrank();

        assertEq(usdc.balanceOf(buyer), 1_000_000_000 - feeAmount);
    }

    function test_revert_sellerWalletEqualsFeeWallet() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.feeWallet = sellerWallet;
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        vm.expectRevert(HaggleSettlementRouter.FeeWalletEqualsSeller.selector);
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    function test_buyerEqualsFeeWallet() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.feeWallet = buyer;
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        router.executeSettlement(p, sig);
        vm.stopPrank();

        assertEq(usdc.balanceOf(buyer), 1_000_000_000 - sellerAmount);
    }

    // ─── Guardian ───────────────────────────────────────────

    function test_guardian_canPause() public {
        vm.prank(guardianAddr);
        router.pause();
        assertTrue(router.paused());
    }

    function test_guardian_cannotUnpause() public {
        vm.prank(owner);
        router.pause();

        vm.prank(guardianAddr);
        vm.expectRevert();
        router.unpause();
    }

    function test_setGuardian() public {
        address newGuardian = makeAddr("newGuardian");
        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit HaggleSettlementRouter.GuardianUpdated(guardianAddr, newGuardian);
        router.setGuardian(newGuardian);
        assertEq(router.guardian(), newGuardian);
    }

    function test_revert_pause_notGuardianOrOwner() public {
        vm.prank(attacker);
        vm.expectRevert(HaggleSettlementRouter.NotGuardianOrOwner.selector);
        router.pause();
    }

    function test_owner_canPause() public {
        vm.prank(owner);
        router.pause();
        assertTrue(router.paused());
    }

    // ─── Pausable ───────────────────────────────────────────

    function test_pause_blocksSettlement() public {
        vm.prank(owner);
        router.pause();

        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        vm.expectRevert();
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    function test_unpause_allowsSettlement() public {
        vm.prank(owner);
        router.pause();
        vm.prank(owner);
        router.unpause();

        _doSettle(orderId);
        assertEq(usdc.balanceOf(sellerWallet), sellerAmount);
    }

    function test_unpause_onlyOwner() public {
        vm.prank(owner);
        router.pause();
        vm.prank(buyer);
        vm.expectRevert();
        router.unpause();
    }

    // ─── Ownable2Step ───────────────────────────────────────

    function test_ownershipTransfer_twoStep() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(owner);
        router.transferOwnership(newOwner);
        assertEq(router.owner(), owner);
        assertEq(router.pendingOwner(), newOwner);

        vm.prank(newOwner);
        router.acceptOwnership();
        assertEq(router.owner(), newOwner);
    }

    // ─── Contract holds no funds invariant ──────────────────

    function test_contractHoldsNoFunds() public {
        _doSettle(orderId);
        assertEq(usdc.balanceOf(address(router)), 0);
    }

    // ─── Fuzz tests ─────────────────────────────────────────

    function testFuzz_amountSplit(uint128 _sellerAmount, uint128 _feeAmount) public {
        uint256 _grossAmount = uint256(_sellerAmount) + uint256(_feeAmount);

        // Respect MIN_GROSS_AMOUNT and MAX_FEE_BPS constraints
        vm.assume(_grossAmount >= router.MIN_GROSS_AMOUNT());
        vm.assume(_grossAmount <= type(uint128).max);
        // Fee cap: feeAmount * 10000 <= grossAmount * MAX_FEE_BPS
        vm.assume(uint256(_feeAmount) * 10000 <= _grossAmount * router.MAX_FEE_BPS());

        usdc.mint(buyer, _grossAmount);

        bytes32 _orderId = keccak256(abi.encode("fuzz", _sellerAmount, _feeAmount));
        address _feeWallet = _feeAmount > 0 ? feeWallet : address(0);

        HaggleSettlementRouter.SettlementParams memory p = HaggleSettlementRouter.SettlementParams({
            orderId: _orderId,
            paymentIntentId: paymentIntentId,
            buyer: buyer,
            seller: seller,
            sellerWallet: sellerWallet,
            feeWallet: _feeWallet,
            asset: address(usdc),
            grossAmount: _grossAmount,
            sellerAmount: _sellerAmount,
            feeAmount: _feeAmount,
            deadline: block.timestamp + 1 hours,
            signerNonce: router.signerNonce()
        });
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), _grossAmount);
        router.executeSettlement(p, sig);
        vm.stopPrank();

        assertEq(usdc.balanceOf(sellerWallet), _sellerAmount);
        assertEq(usdc.balanceOf(feeWallet), _feeAmount);
        assertEq(usdc.balanceOf(address(router)), 0);
    }

    function testFuzz_amountMismatchReverts(uint128 _sellerAmount, uint128 _feeAmount, uint128 _grossAmount) public {
        vm.assume(uint256(_grossAmount) >= router.MIN_GROSS_AMOUNT());
        vm.assume(uint256(_sellerAmount) + uint256(_feeAmount) != uint256(_grossAmount));

        HaggleSettlementRouter.SettlementParams memory p = HaggleSettlementRouter.SettlementParams({
            orderId: orderId,
            paymentIntentId: paymentIntentId,
            buyer: buyer,
            seller: seller,
            sellerWallet: sellerWallet,
            feeWallet: feeWallet,
            asset: address(usdc),
            grossAmount: _grossAmount,
            sellerAmount: _sellerAmount,
            feeAmount: _feeAmount,
            deadline: block.timestamp + 1 hours,
            signerNonce: router.signerNonce()
        });
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), _grossAmount);
        vm.expectRevert(HaggleSettlementRouter.AmountMismatch.selector);
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    // ─── [3rd Review] confirmSigner mismatch guard ──────────

    function test_revert_confirmSigner_signerMismatch() public {
        address a = makeAddr("signerA");
        address b = makeAddr("signerB");
        vm.prank(owner);
        router.proposeSigner(a);
        vm.warp(block.timestamp + router.SIGNER_ROTATION_DELAY());

        vm.prank(owner);
        vm.expectRevert(HaggleSettlementRouter.SignerMismatch.selector);
        router.confirmSigner(b);
    }

    // ─── [3rd Review] proposeSigner double-call emits cancel ─

    function test_proposeSigner_doubleCallEmitsCancel() public {
        address a = makeAddr("signerA");
        address b = makeAddr("signerB");

        vm.prank(owner);
        router.proposeSigner(a);

        vm.prank(owner);
        vm.expectEmit(true, false, false, false);
        emit HaggleSettlementRouter.SignerRotationCancelled(a);
        router.proposeSigner(b);

        assertEq(router.pendingSigner(), b);
    }

    // ─── [3rd Review] Guardian pause cooldown ────────────────

    function test_guardian_pauseCooldown() public {
        vm.prank(owner);
        router.setGuardian(makeAddr("guard"));

        // First pause by guardian — OK
        vm.prank(makeAddr("guard"));
        router.pause();

        vm.prank(owner);
        router.unpause();

        // Immediate re-pause by guardian — cooldown active
        vm.prank(makeAddr("guard"));
        vm.expectRevert(HaggleSettlementRouter.PauseCooldownActive.selector);
        router.pause();

        // After cooldown — OK
        vm.warp(block.timestamp + router.PAUSE_COOLDOWN());
        vm.prank(makeAddr("guard"));
        router.pause();
    }

    function test_owner_noPauseCooldown() public {
        // Owner should have no cooldown
        vm.prank(owner);
        router.pause();
        vm.prank(owner);
        router.unpause();
        vm.prank(owner);
        router.pause(); // no revert
    }

    // ─── [3rd Review] Ownership transfer cancels pending rotation ─

    function test_ownershipTransfer_cancelsPendingRotation() public {
        address newSigner = makeAddr("newSigner");
        address newOwner = makeAddr("newOwner");

        vm.prank(owner);
        router.proposeSigner(newSigner);
        assertEq(router.pendingSigner(), newSigner);

        vm.prank(owner);
        router.transferOwnership(newOwner);
        vm.prank(newOwner);
        router.acceptOwnership();

        // Pending rotation should be cancelled
        assertEq(router.pendingSigner(), address(0));
        assertEq(router.signerRotationReadyAt(), 0);
    }

    // ─── [4th Review] Emergency Freeze & New Checks ──────────

    function test_emergencyFreezeSigner() public {
        assertEq(router.signer(), signerAddr);
        uint256 nonceBefore = router.signerNonce();

        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit HaggleSettlementRouter.SignerUpdated(signerAddr, address(0));
        router.emergencyFreezeSigner();

        assertEq(router.signer(), address(0));
        assertEq(router.signerNonce(), nonceBefore + 1);
    }

    function test_emergencyFreeze_cancelsPendingRotation() public {
        address newSigner = makeAddr("newSigner");
        vm.startPrank(owner);
        router.proposeSigner(newSigner);
        assertEq(router.pendingSigner(), newSigner);

        vm.expectEmit(true, false, false, false);
        emit HaggleSettlementRouter.SignerRotationCancelled(newSigner);
        router.emergencyFreezeSigner();
        vm.stopPrank();

        assertEq(router.pendingSigner(), address(0));
        assertEq(router.signerRotationReadyAt(), 0);
        assertEq(router.signer(), address(0));
    }

    function test_emergencyFreeze_bricksSettlements() public {
        vm.prank(owner);
        router.emergencyFreezeSigner();

        // After freeze, signerNonce incremented so we need params with new nonce
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.signerNonce = router.signerNonce(); // match new nonce
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        // signer is address(0) → SignerNotSet
        vm.expectRevert(HaggleSettlementRouter.SignerNotSet.selector);
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    function test_revert_emergencyFreeze_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        router.emergencyFreezeSigner();
    }

    function test_revert_buyerIsSeller() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        p.seller = buyer;
        bytes memory sig = _signParams(SIGNER_PK, p);

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        vm.expectRevert(HaggleSettlementRouter.BuyerIsSeller.selector);
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    // ─── [Manual Override] adminResetOrder / adminVoidOrder ──

    function test_adminResetOrder() public {
        // First settle normally
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        bytes memory sig = _signParams(SIGNER_PK, p);
        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        router.executeSettlement(p, sig);
        vm.stopPrank();

        assertTrue(router.settledOrders(p.orderId));

        // Admin resets
        vm.prank(owner);
        vm.expectEmit(true, false, false, false);
        emit HaggleSettlementRouter.OrderReset(p.orderId);
        router.adminResetOrder(p.orderId);

        assertFalse(router.settledOrders(p.orderId));
    }

    function test_adminResetOrder_allowsReSettlement() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        bytes memory sig = _signParams(SIGNER_PK, p);
        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        router.executeSettlement(p, sig);
        vm.stopPrank();

        // Reset
        vm.prank(owner);
        router.adminResetOrder(p.orderId);

        // Can re-settle with new params
        usdc.mint(buyer, grossAmount); // top up funds
        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        router.executeSettlement(p, sig);
        vm.stopPrank();

        assertTrue(router.settledOrders(p.orderId));
    }

    function test_revert_adminResetOrder_notSettled() public {
        vm.prank(owner);
        vm.expectRevert(HaggleSettlementRouter.OrderNotSettled.selector);
        router.adminResetOrder(keccak256("never-settled"));
    }

    function test_revert_adminResetOrder_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        router.adminResetOrder(keccak256("some-order"));
    }

    function test_adminVoidOrder() public {
        bytes32 oid = keccak256("fraud-order");

        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit HaggleSettlementRouter.OrderVoidedEvent(oid, "fraud detected");
        router.adminVoidOrder(oid, "fraud detected");

        assertTrue(router.voidedOrders(oid));
    }

    function test_adminVoidOrder_blocksSettlement() public {
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        bytes memory sig = _signParams(SIGNER_PK, p);

        // Void the order before settlement
        vm.prank(owner);
        router.adminVoidOrder(p.orderId, "preemptive block");

        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        vm.expectRevert(HaggleSettlementRouter.OrderVoided.selector);
        router.executeSettlement(p, sig);
        vm.stopPrank();
    }

    function test_adminVoidOrder_alsoResetsSettled() public {
        // Settle first
        HaggleSettlementRouter.SettlementParams memory p = _defaultParams();
        bytes memory sig = _signParams(SIGNER_PK, p);
        vm.startPrank(buyer);
        usdc.approve(address(router), grossAmount);
        router.executeSettlement(p, sig);
        vm.stopPrank();

        // Void (sets voidedOrders=true, settledOrders=false)
        vm.prank(owner);
        router.adminVoidOrder(p.orderId, "post-settlement fraud");

        assertTrue(router.voidedOrders(p.orderId));
        assertFalse(router.settledOrders(p.orderId));
    }

    function test_revert_adminVoidOrder_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        router.adminVoidOrder(keccak256("order"), "test");
    }
}
