// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Haggle Test USDC
/// @notice Mintable Base Sepolia-only settlement asset for staging tests.
/// @dev This token has no monetary value and must never be configured in production.
contract HaggleTestUSDC is ERC20, Ownable2Step {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 1e6;

    error ZeroAddress();
    error ZeroAmount();
    error MaxSupplyExceeded();

    constructor(address initialOwner) ERC20("Haggle Test USDC", "hUSDC") Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (totalSupply() + amount > MAX_SUPPLY) revert MaxSupplyExceeded();
        _mint(to, amount);
    }

    function renounceOwnership() public pure override {
        revert("disabled");
    }
}
