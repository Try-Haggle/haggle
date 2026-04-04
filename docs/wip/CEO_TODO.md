# CEO 직접 처리 항목

> 코드가 아닌 인프라/키/계정 작업. 3man team이 대신할 수 없음.

---

## 1. Base Sepolia 컨트랙트 배포
```bash
cd packages/contracts

# 필요한 env vars 설정
export DEPLOYER_PRIVATE_KEY=<새 지갑 프라이빗 키>
export SIGNER_ADDRESS=<EIP-712 서명용 주소>
export USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e  # Base Sepolia USDC

# 배포
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
```
배포 후 출력된 주소를 `packages/contracts/src/index.ts`의 `CONTRACT_ADDRESSES`에 입력.

## 2. 환경 변수 설정 (Railway / .env)
```env
# x402 모드
HAGGLE_X402_MODE=real
HAGGLE_BASE_RPC_URL=<Base Sepolia RPC (Alchemy/Infura)>
HAGGLE_SETTLEMENT_ROUTER_ADDRESS=<배포 후 주소>
HAGGLE_DISPUTE_REGISTRY_ADDRESS=<배포 후 주소>
HAGGLE_X402_USDC_ASSET_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e

# 릴레이어 키
HAGGLE_ROUTER_RELAYER_PRIVATE_KEY=<릴레이어 지갑 프라이빗 키>
HAGGLE_X402_FEE_WALLET=<플랫폼 수수료 수령 지갑>

# Coinbase CDP (x402 facilitator)
HAGGLE_X402_FACILITATOR_URL=<CDP facilitator endpoint>
CDP_API_KEY_ID=<CDP API key>
CDP_API_KEY_SECRET=<CDP API secret>

# 지갑 매핑 (MVP용, 추후 DB로 교체)
HAGGLE_X402_SELLER_WALLET_MAP={"seller_uuid":"0x..."}
HAGGLE_X402_BUYER_WALLET_MAP={"buyer_uuid":"0x..."}

# DB
DATABASE_URL=<Supabase connection string>
```

## 3. 배포 인프라
- [ ] Railway 프로젝트 생성 (API 서버)
- [ ] Vercel 프로젝트 연결 (Next.js 웹앱)
- [ ] tryhaggle.ai DNS 설정 (API + 웹앱 서브도메인)
- [ ] Supabase 프로젝트 + DB migration 실행

## 4. 외부 서비스 계정
- [ ] Coinbase Developer Platform 가입 + API key 발급
- [ ] Base Sepolia faucet에서 테스트 ETH 수령
- [ ] EasyPost API key (배송 추적용, 나중)

## 5. 법률 (런칭 전 필수)
- [ ] 핀테크/증권법 변호사 상담
- [ ] ToS 7개 필수 조항 작성

---

*완료 시 체크하고 날짜 기록. 3man team은 이 항목들과 독립적으로 진행 중.*
*Created: 2026-04-04*
