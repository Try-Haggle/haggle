// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../sol/HaggleSettlementRouter.sol";
import "../sol/HaggleDisputeRegistry.sol";

/// @title Deploy
/// @notice Deploys HaggleSettlementRouter + HaggleDisputeRegistry to Base L2.
/// @dev Usage:
///   forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
///
///   Required env vars:
///     DEPLOYER_PRIVATE_KEY  — Private key of the deployer (becomes initial owner)
///     SIGNER_ADDRESS        — Backend signer address for EIP-712 settlement verification
///     USDC_ADDRESS          — USDC token address on the target chain
///
///   Optional env vars:
///     GUARDIAN_ADDRESS       — Guardian address for emergency pause (default: deployer)
///     MAX_SETTLEMENT_AMOUNT — Per-tx settlement cap in USDC base units (default: 0 = no cap)
contract Deploy is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);
        address signerAddress = vm.envAddress("SIGNER_ADDRESS");
        address usdcAddress = vm.envAddress("USDC_ADDRESS");

        // Optional: guardian and settlement cap
        address guardianAddress = vm.envOr("GUARDIAN_ADDRESS", deployer);
        uint256 maxSettlement = vm.envOr("MAX_SETTLEMENT_AMOUNT", uint256(0));

        console.log("Deployer:", deployer);
        console.log("Signer:", signerAddress);
        console.log("Guardian:", guardianAddress);
        console.log("USDC:", usdcAddress);
        console.log("Max Settlement:", maxSettlement);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerPk);

        // Deploy Settlement Router
        HaggleSettlementRouter router = new HaggleSettlementRouter(deployer, signerAddress);
        console.log("SettlementRouter deployed at:", address(router));

        // Allowlist USDC
        router.allowAsset(usdcAddress);
        console.log("USDC allowlisted");

        // Set guardian (if different from deployer)
        if (guardianAddress != address(0)) {
            router.setGuardian(guardianAddress);
            console.log("Guardian set:", guardianAddress);
        }

        // Set settlement cap (if provided)
        if (maxSettlement > 0) {
            router.setMaxSettlementAmount(maxSettlement);
            console.log("Max settlement amount set:", maxSettlement);
        }

        // Deploy Dispute Registry
        HaggleDisputeRegistry registry = new HaggleDisputeRegistry(deployer);
        console.log("DisputeRegistry deployed at:", address(registry));

        vm.stopBroadcast();

        // Verification summary
        console.log("\n--- Deployment Summary ---");
        console.log("SettlementRouter:", address(router));
        console.log("DisputeRegistry:", address(registry));
        console.log("Owner:", deployer);
        console.log("Signer:", signerAddress);
        console.log("Guardian:", guardianAddress);
        console.log("Max Fee BPS:", router.MAX_FEE_BPS());
        console.log("Min Gross Amount:", router.MIN_GROSS_AMOUNT());
        console.log("Signer Rotation Delay:", router.SIGNER_ROTATION_DELAY());

        // Post-deployment checklist
        console.log("\n--- POST-DEPLOYMENT CHECKLIST ---");
        console.log("[ ] Transfer ownership to multisig (Ownable2Step)");
        console.log("[ ] Verify signer key is in Cloud KMS");
        console.log("[ ] Verify guardian is a fast-response EOA or bot");
        console.log("[ ] Set maxSettlementAmount if needed");
        console.log("[ ] Verify contract on Basescan");
        console.log("[ ] Update CONTRACT_ADDRESSES in packages/contracts/src/index.ts");
    }
}
