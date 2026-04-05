// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../sol/HaggleSettlementRouter.sol";
import "./MockUSDC.sol";

/// @dev Handler contract that exposes bounded actions for invariant testing.
contract SettlementHandler is Test {
    HaggleSettlementRouter public router;
    MockUSDC public usdc;
    uint256 public signerPk;

    address public buyer;
    address public sellerWallet = makeAddr("sellerWallet");
    address public feeWallet = makeAddr("feeWallet");
    address public seller = makeAddr("seller");

    uint256 public settleCount;

    constructor(HaggleSettlementRouter _router, MockUSDC _usdc, uint256 _signerPk, address _buyer) {
        router = _router;
        usdc = _usdc;
        signerPk = _signerPk;
        buyer = _buyer;
    }

    function settle(uint128 _sellerAmount, uint128 _feeAmount, uint256 orderSeed) external {
        _sellerAmount = uint128(bound(_sellerAmount, 1, 1_000_000e6));
        uint256 _grossAmount = uint256(_sellerAmount) + uint256(_feeAmount);
        if (_grossAmount < router.MIN_GROSS_AMOUNT() || _grossAmount > 1_000_000e6) return;

        // Enforce fee cap: feeAmount * 10000 <= grossAmount * MAX_FEE_BPS
        if (uint256(_feeAmount) * 10000 > _grossAmount * router.MAX_FEE_BPS()) return;

        bytes32 _orderId = keccak256(abi.encode("inv", orderSeed, settleCount));
        if (router.settledOrders(_orderId)) return;

        address fw = _feeAmount > 0 ? feeWallet : address(0);

        HaggleSettlementRouter.SettlementParams memory p = HaggleSettlementRouter.SettlementParams({
            orderId: _orderId,
            paymentIntentId: keccak256("pi"),
            buyer: buyer,
            seller: seller,
            sellerWallet: sellerWallet,
            feeWallet: fw,
            asset: address(usdc),
            grossAmount: _grossAmount,
            sellerAmount: _sellerAmount,
            feeAmount: _feeAmount,
            deadline: block.timestamp + 1 hours,
            signerNonce: router.signerNonce()
        });

        // Sign
        bytes32 structHash = keccak256(abi.encode(
            router.SETTLEMENT_TYPEHASH(),
            p.orderId, p.paymentIntentId, p.buyer, p.seller, p.sellerWallet,
            p.feeWallet, p.asset, p.grossAmount, p.sellerAmount, p.feeAmount,
            p.deadline, p.signerNonce
        ));
        bytes32 domainSep = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("HaggleSettlementRouter"),
            keccak256("1"),
            block.chainid,
            address(router)
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        usdc.mint(buyer, _grossAmount);

        vm.startPrank(buyer);
        usdc.approve(address(router), _grossAmount);
        try router.executeSettlement(p, sig) {
            settleCount++;
        } catch {}
        vm.stopPrank();
    }
}

contract HaggleSettlementRouterInvariantTest is Test {
    HaggleSettlementRouter public router;
    MockUSDC public usdc;
    SettlementHandler public handler;

    uint256 constant SIGNER_PK = 0xA11CE;
    address buyer = makeAddr("buyer");
    address owner = makeAddr("owner");

    function setUp() public {
        address signerAddr = vm.addr(SIGNER_PK);
        vm.startPrank(owner);
        router = new HaggleSettlementRouter(owner, signerAddr);
        usdc = new MockUSDC();
        router.allowAsset(address(usdc));
        vm.stopPrank();

        handler = new SettlementHandler(router, usdc, SIGNER_PK, buyer);
        targetContract(address(handler));
    }

    /// @dev The router contract must never hold any token balance.
    function invariant_contractHoldsNoFunds() public view {
        assertEq(usdc.balanceOf(address(router)), 0);
    }
}
