# Contract Deployment Guide

## Prerequisites

1. Foundry 설치: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
2. OpenZeppelin 설치: `cd packages/contracts && forge install OpenZeppelin/openzeppelin-contracts --no-commit`
3. Base Sepolia ETH: https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet

## Environment Variables

```bash
# Required
export DEPLOYER_PRIVATE_KEY=0x...       # Deployer wallet private key
export SIGNER_ADDRESS=0x...             # Backend relayer address (= HAGGLE_ROUTER_RELAYER_PRIVATE_KEY의 address)
export USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e  # Base Sepolia USDC

# Optional
export GUARDIAN_ADDRESS=0x...           # Emergency pause guardian (default: deployer)
export MAX_SETTLEMENT_AMOUNT=0          # Per-tx cap in USDC base units (0 = no cap)

# RPC & Verification
export BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
export BASESCAN_API_KEY=YOUR_KEY        # https://basescan.org/myapikey
```

## Deploy to Base Sepolia (Testnet)

```bash
cd packages/contracts

forge script script/Deploy.s.sol \
  --rpc-url base_sepolia \
  --broadcast \
  --verify
```

## Deploy to Base Mainnet (Production)

```bash
# ⚠️ Mainnet 배포는 보안 감사 완료 후에만
export USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913  # Base Mainnet USDC

forge script script/Deploy.s.sol \
  --rpc-url base \
  --broadcast \
  --verify
```

## Post-Deployment

1. 배포 출력에서 주소 복사:
   ```
   SettlementRouter: 0x...
   DisputeRegistry: 0x...
   ```

2. `packages/contracts/src/index.ts` 업데이트:
   ```typescript
   const CONTRACT_ADDRESSES = {
     settlementRouter: "0x...",  // ← 여기
     disputeRegistry: "0x...",   // ← 여기
   };
   ```

3. API 서버 환경변수 설정:
   ```
   HAGGLE_SETTLEMENT_ROUTER_ADDRESS=0x...
   HAGGLE_DISPUTE_REGISTRY_ADDRESS=0x...
   ```

4. Post-deployment checklist:
   - [ ] Ownership을 multisig로 이전 (Ownable2Step)
   - [ ] Signer key가 Cloud KMS에 있는지 확인
   - [ ] Guardian이 fast-response EOA인지 확인
   - [ ] Basescan에서 컨트랙트 verified 확인
   - [ ] maxSettlementAmount 설정 (필요시)

## Verify Existing Contract

```bash
forge verify-contract \
  --chain-id 84532 \
  --constructor-args $(cast abi-encode "constructor(address,address)" $DEPLOYER_ADDRESS $SIGNER_ADDRESS) \
  0xCONTRACT_ADDRESS \
  sol/HaggleSettlementRouter.sol:HaggleSettlementRouter
```

## Run Tests

```bash
cd packages/contracts
forge test -vvv
```
