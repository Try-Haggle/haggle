// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../sol/HaggleDisputeBondEscrow.sol";
import "./MockUSDC.sol";

contract HaggleDisputeBondEscrowTest is Test {
    HaggleDisputeBondEscrow escrow;
    MockUSDC usdc;
    address buyer = makeAddr("buyer");
    address seller = makeAddr("seller");
    address vault = makeAddr("vault");
    bytes32 disputeId = keccak256("dispute-1");
    uint128 constant T2_FEE = 12_000_000;
    uint128 constant T3_FEE = 30_000_000;

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new HaggleDisputeBondEscrow(usdc, vault, address(this));
        usdc.mint(buyer, 100_000_000);
        usdc.mint(seller, 100_000_000);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(seller);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function openAndFund(uint8 tier, uint128 fee) internal {
        escrow.openTier(disputeId, tier, buyer, seller, fee, uint64(block.timestamp + 2 days));
        vm.prank(buyer);
        escrow.fund(disputeId, tier, HaggleDisputeBondEscrow.Party.BUYER);
        vm.prank(seller);
        escrow.fund(disputeId, tier, HaggleDisputeBondEscrow.Party.SELLER);
    }

    function testBuyerWinsGetsFullBondAndPrincipalIsUntouched() public {
        openAndFund(2, T2_FEE);
        escrow.startReview(disputeId, 2);
        escrow.finalizeCase(disputeId, false);
        assertEq(usdc.balanceOf(buyer), 100_000_000);
        assertEq(usdc.balanceOf(seller), 100_000_000 - T2_FEE);
        assertEq(escrow.accruedFees(disputeId), T2_FEE);
        assertEq(usdc.balanceOf(address(escrow)), T2_FEE);
        vm.expectRevert(HaggleDisputeBondEscrow.CaseAlreadyFinalized.selector);
        escrow.finalizeCase(disputeId, false);
    }

    function testSellerWinsAfterT3ReversalPaysCumulativeFees() public {
        openAndFund(2, T2_FEE);
        escrow.startReview(disputeId, 2);
        openAndFund(3, T3_FEE);
        escrow.startReview(disputeId, 3);
        escrow.finalizeCase(disputeId, true);
        assertEq(usdc.balanceOf(seller), 100_000_000);
        assertEq(usdc.balanceOf(buyer), 100_000_000 - T2_FEE - T3_FEE);
        assertEq(escrow.accruedFees(disputeId), T2_FEE + T3_FEE);
    }

    function testCannotStartWithoutBothBonds() public {
        escrow.openTier(disputeId, 2, buyer, seller, T2_FEE, uint64(block.timestamp + 2 days));
        vm.prank(buyer);
        escrow.fund(disputeId, 2, HaggleDisputeBondEscrow.Party.BUYER);
        vm.expectRevert(HaggleDisputeBondEscrow.BondsIncomplete.selector);
        escrow.startReview(disputeId, 2);
        assertEq(usdc.balanceOf(address(escrow)), T2_FEE);
    }

    function testSellerDefaultBeforeT2ReturnsBuyerBondWithoutFee() public {
        escrow.openTier(disputeId, 2, buyer, seller, T2_FEE, uint64(block.timestamp + 2 days));
        vm.prank(buyer);
        escrow.fund(disputeId, 2, HaggleDisputeBondEscrow.Party.BUYER);
        vm.expectRevert(HaggleDisputeBondEscrow.DefaultNotProven.selector);
        escrow.finalizeSellerDefault(disputeId, 2);
        vm.warp(block.timestamp + 2 days + 1);
        escrow.finalizeSellerDefault(disputeId, 2);
        assertTrue(escrow.caseSellerDefault(disputeId));
        assertEq(usdc.balanceOf(buyer), 100_000_000);
        assertEq(escrow.accruedFees(disputeId), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function testT3SellerDefaultPreservesCompletedT2Fee() public {
        openAndFund(2, T2_FEE);
        escrow.startReview(disputeId, 2);
        escrow.openTier(disputeId, 3, buyer, seller, T3_FEE, uint64(block.timestamp + 3 days));
        vm.prank(buyer);
        escrow.fund(disputeId, 3, HaggleDisputeBondEscrow.Party.BUYER);
        vm.warp(block.timestamp + 3 days + 1);
        escrow.finalizeSellerDefault(disputeId, 3);
        assertEq(usdc.balanceOf(buyer), 100_000_000);
        assertEq(usdc.balanceOf(seller), 100_000_000 - T2_FEE);
        assertEq(escrow.accruedFees(disputeId), T2_FEE);
    }

    function testUnstartedCancellationReturnsEachOwnedBond() public {
        escrow.openTier(disputeId, 2, buyer, seller, T2_FEE, uint64(block.timestamp + 2 days));
        vm.prank(buyer);
        escrow.fund(disputeId, 2, HaggleDisputeBondEscrow.Party.BUYER);
        escrow.cancelUnstarted(disputeId, 2);
        assertEq(usdc.balanceOf(buyer), 100_000_000);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function testOnlyPartyCanFundAndCannotFundTwice() public {
        escrow.openTier(disputeId, 2, buyer, seller, T2_FEE, uint64(block.timestamp + 2 days));
        vm.expectRevert(HaggleDisputeBondEscrow.InvalidParty.selector);
        escrow.fund(disputeId, 2, HaggleDisputeBondEscrow.Party.BUYER);
        vm.prank(buyer);
        escrow.fund(disputeId, 2, HaggleDisputeBondEscrow.Party.BUYER);
        vm.prank(buyer);
        vm.expectRevert(HaggleDisputeBondEscrow.AlreadyFunded.selector);
        escrow.fund(disputeId, 2, HaggleDisputeBondEscrow.Party.BUYER);
    }

    function testRelayerCanFundOnlyForApprovedParty() public {
        escrow.openTier(disputeId, 2, buyer, seller, T2_FEE, uint64(block.timestamp + 2 days));
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        escrow.fundFor(disputeId, 2, HaggleDisputeBondEscrow.Party.BUYER, buyer);
        vm.expectRevert(HaggleDisputeBondEscrow.InvalidParty.selector);
        escrow.fundFor(disputeId, 2, HaggleDisputeBondEscrow.Party.BUYER, seller);
        escrow.fundFor(disputeId, 2, HaggleDisputeBondEscrow.Party.BUYER, buyer);
        assertEq(usdc.balanceOf(address(escrow)), T2_FEE);
    }

    function testOwnerCanRotateOperatorWithoutGivingFeeVaultAccess() public {
        address nextOperator = makeAddr("next-operator");
        escrow.setOperator(nextOperator);
        vm.expectRevert(HaggleDisputeBondEscrow.UnauthorizedOperator.selector);
        escrow.openTier(disputeId, 2, buyer, seller, T2_FEE, uint64(block.timestamp + 2 days));
        vm.prank(nextOperator);
        escrow.openTier(disputeId, 2, buyer, seller, T2_FEE, uint64(block.timestamp + 2 days));
        vm.prank(nextOperator);
        vm.expectRevert();
        escrow.releaseFees(disputeId);
    }

    function testRefundsFollowEachTiersFundingWallet() public {
        address nextBuyer = makeAddr("next-buyer");
        address nextSeller = makeAddr("next-seller");
        usdc.mint(nextBuyer, 100_000_000);
        usdc.mint(nextSeller, 100_000_000);
        vm.prank(nextBuyer);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(nextSeller);
        usdc.approve(address(escrow), type(uint256).max);
        openAndFund(2, T2_FEE);
        escrow.startReview(disputeId, 2);
        escrow.openTier(disputeId, 3, nextBuyer, nextSeller, T3_FEE, uint64(block.timestamp + 3 days));
        vm.prank(nextBuyer);
        escrow.fund(disputeId, 3, HaggleDisputeBondEscrow.Party.BUYER);
        vm.warp(block.timestamp + 3 days + 1);
        escrow.finalizeSellerDefault(disputeId, 3);
        assertEq(usdc.balanceOf(buyer), 100_000_000);
        assertEq(usdc.balanceOf(nextBuyer), 100_000_000);
        assertEq(usdc.balanceOf(seller), 100_000_000 - T2_FEE);
        assertEq(usdc.balanceOf(nextSeller), 100_000_000);
    }
}
