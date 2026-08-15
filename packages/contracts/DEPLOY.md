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

### Current Base Sepolia deployment

The tracked deployment manifest is `deployments/base-sepolia.json`.

| Contract | Address |
| --- | --- |
| SettlementRouter | `0x5652321f6d5d0337f7BD754Ba66000616dA8F228` |
| ConditionalSettlement | `0x47228b3B82E3baEF46722aC9475eBfd49Da22a7B` |
| DisputeRegistry | `0x71311522f40981C62C7A930DbaC4e3997adFf8fc` |
| Haggle Test USDC | `0x579807433033757E895437EEfa9Ae25F387c3fCa` |

This deployment allowlists both the legacy Base Sepolia USDC and Haggle Test USDC.
Staging checkout is pinned to hUSDC by its settlement asset profile. `SettlementRouter`
has a 100-token per-settlement cap; the buyer-funded `ConditionalSettlement` checkout
path has no contract-level amount cap and is limited by the signed grant and the
buyer's token balance.

Staging uses the `base-sepolia-husdc` settlement asset profile. The test buyer
`0x0da9Ebd940a2B0bBB91d9A3813F72dfc2FA1A658` received 100,000 hUSDC. Production
uses the separate `base-usdc` profile, which pins the official Base USDC contract.

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
   ConditionalSettlement: 0x...
   DisputeRegistry: 0x...
   ```

2. `packages/contracts/src/index.ts` 업데이트:
   ```typescript
   const CONTRACT_ADDRESSES = {
     settlementRouter: "0x...",  // ← 여기
     conditionalSettlement: "0x...",
     disputeRegistry: "0x...",   // ← 여기
   };
   ```

3. API 서버 환경변수 설정:
   ```
   HAGGLE_SETTLEMENT_ROUTER_ADDRESS=0x...
   HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS=0x...
   HAGGLE_DISPUTE_REGISTRY_ADDRESS=0x...
   ```

   `HAGGLE_X402_PAYMENT_RECEIVER_ADDRESS`는 x402 exact transfer를 받을 dedicated receiver/sweep contract가 배포된 뒤에만 설정한다.
   `HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS`를 x402 `payTo`로 직접 쓰면 `createAndFund()`가 호출되지 않고 토큰만 전송될 수 있다.

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

forge verify-contract \
  --chain-id 84532 \
  --constructor-args $(cast abi-encode "constructor(address,address)" $DEPLOYER_ADDRESS $SIGNER_ADDRESS) \
  0xCONDITIONAL_SETTLEMENT_ADDRESS \
  sol/HaggleConditionalSettlement.sol:HaggleConditionalSettlement
```

## Run Tests

```bash
cd packages/contracts
forge test -vvv
```

`BASE_SEPOLIA_RPC_URL`이 없으면 배포본 포크 테스트 5개는 건너뛰고 로컬 테스트만 실행된다.
추적 중인 실제 Base Sepolia 배포 코드까지 검증하려면 다음처럼 실행한다.

```bash
cd packages/contracts
set -a
source .env.local
set +a
forge test --match-contract HaggleConditionalSettlementBaseSepoliaTest --summary
```

이 테스트는 원격 체인의 코드와 상태를 읽어 로컬 포크를 만들고, 포크 안에서만 signer 교체·hUSDC mint와
fund/release/refund/expire를 실행한다. Base Sepolia에 트랜잭션을 보내거나 실제 상태를 변경하지 않는다.

### Conditional settlement 운영 점검

- 배포 주소의 hUSDC 잔액은 `SettlementFunded - SettlementReleased - SettlementRefunded` 이벤트 합계와
  주기적으로 대조한다. 단순 ERC-20 직접 전송과 만료됐지만 처리되지 않은 예치를 구분해야 한다.
- `expire`는 만료 뒤 누구나 호출할 수 있지만 자동으로 실행되지는 않는다. 만료 예치 탐지, 호출 주체,
  재시도와 receipt 확인을 운영 절차로 지정한다.
- 현재 `pause`는 신규 funding뿐 아니라 기존 예치의 release, signed refund, buyer-protective expiry도 막는다.
  실제 자산 사용 전 최대 pause 시간·긴급 unpause 담당자를 정하거나, 기존 자금 출구를 pause에서 제외하는
  설계 변경을 별도 리뷰한다.
- `HaggleConditionalSettlement.setSigner`는 owner가 즉시 실행한다. Router의 48시간 signer rotation과 같은
  지연 보호가 필요할지는 실제 자산 전환 전에 별도로 결정한다.
