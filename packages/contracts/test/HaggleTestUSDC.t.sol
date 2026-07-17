// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HaggleTestUSDC} from "../sol/HaggleTestUSDC.sol";

contract HaggleTestUSDCTest is Test {
    HaggleTestUSDC internal token;
    address internal owner = makeAddr("owner");
    address internal buyer = makeAddr("buyer");
    address internal attacker = makeAddr("attacker");

    function setUp() public {
        token = new HaggleTestUSDC(owner);
    }

    function test_metadataMatchesSixDecimalTestAsset() public view {
        assertEq(token.name(), "Haggle Test USDC");
        assertEq(token.symbol(), "hUSDC");
        assertEq(token.decimals(), 6);
        assertEq(token.owner(), owner);
    }

    function test_ownerCanMintLargeStagingBalance() public {
        vm.prank(owner);
        token.mint(buyer, 100_000 * 1e6);

        assertEq(token.balanceOf(buyer), 100_000 * 1e6);
        assertEq(token.totalSupply(), 100_000 * 1e6);
    }

    function test_nonOwnerCannotMint() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", attacker));
        token.mint(attacker, 1e6);
    }

    function test_mintRejectsZeroRecipientAndAmount() public {
        vm.startPrank(owner);
        vm.expectRevert(HaggleTestUSDC.ZeroAddress.selector);
        token.mint(address(0), 1e6);

        vm.expectRevert(HaggleTestUSDC.ZeroAmount.selector);
        token.mint(buyer, 0);
        vm.stopPrank();
    }

    function test_mintCannotExceedMaxSupply() public {
        vm.startPrank(owner);
        token.mint(buyer, token.MAX_SUPPLY());
        vm.expectRevert(HaggleTestUSDC.MaxSupplyExceeded.selector);
        token.mint(buyer, 1);
        vm.stopPrank();
    }

    function test_renounceOwnershipIsDisabled() public {
        vm.prank(owner);
        vm.expectRevert(bytes("disabled"));
        token.renounceOwnership();
    }
}
