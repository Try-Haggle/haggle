// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {HaggleConditionalSettlement} from "../sol/HaggleConditionalSettlement.sol";
import {HaggleSettlementRouter} from "../sol/HaggleSettlementRouter.sol";
import {HaggleTestUSDC} from "../sol/HaggleTestUSDC.sol";

/// @notice Deploys hUSDC, mints a staging balance, and allowlists it for both settlement paths.
contract DeployStagingTestUSDC is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;
    uint256 internal constant DEFAULT_MINT_AMOUNT = 100_000 * 1e6;

    error WrongChain(uint256 actualChainId);
    error DeployerIsNotContractOwner(address contractAddress, address actualOwner);

    function run() external {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) revert WrongChain(block.chainid);

        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);
        address recipient = vm.envAddress("TEST_TOKEN_RECIPIENT");
        uint256 mintAmount = vm.envOr("TEST_TOKEN_MINT_AMOUNT", DEFAULT_MINT_AMOUNT);
        HaggleSettlementRouter router = HaggleSettlementRouter(vm.envAddress("HAGGLE_SETTLEMENT_ROUTER_ADDRESS"));
        HaggleConditionalSettlement conditional =
            HaggleConditionalSettlement(vm.envAddress("HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS"));

        if (router.owner() != deployer) {
            revert DeployerIsNotContractOwner(address(router), router.owner());
        }
        if (conditional.owner() != deployer) {
            revert DeployerIsNotContractOwner(address(conditional), conditional.owner());
        }

        vm.startBroadcast(deployerPk);
        HaggleTestUSDC token = new HaggleTestUSDC(deployer);
        token.mint(recipient, mintAmount);
        router.allowAsset(address(token));
        conditional.allowAsset(address(token));
        vm.stopBroadcast();

        require(token.balanceOf(recipient) == mintAmount, "mint verification failed");
        require(router.allowedAssets(address(token)), "router allowlist verification failed");
        require(conditional.allowedAssets(address(token)), "conditional allowlist verification failed");

        console2.log("HaggleTestUSDC:", address(token));
        console2.log("Owner:", deployer);
        console2.log("Recipient:", recipient);
        console2.log("Minted base units:", mintAmount);
        console2.log("Minted hUSDC:", mintAmount / 1e6);
    }
}
