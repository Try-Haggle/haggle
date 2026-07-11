# Haggle — local development bootstrap
#
# Thin entry point over pnpm / supabase CLI (Environment_Separation_Playbook §12).
# Goal: a new developer runs ONE command (`make setup`) and gets a fully working
# local stack — Supabase (Auth/Storage/Postgres/pgvector) + schema + fixtures.
#
# Migration source of truth = Drizzle (`packages/db/drizzle/`). Supabase CLI only
# runs the local infra; it does NOT own migrations (config.toml: db.migrations.enabled=false).
#
# Requirements (per developer, one-time):
#   - Docker running
#   - Supabase CLI:  brew install supabase/tap/supabase
#   - Node 22 (.nvmrc):  nvm use

.DEFAULT_GOAL := help
.PHONY: help setup dev dev-all landing kill-dev migrate migrate-new seed seed-full reset stop status db-url

# Dev server ports (web · api · landing). Freed before `make dev` so a stale
# run in another terminal doesn't cause EADDRINUSE.
DEV_PORTS ?= 3000 3001 3002

# Local DB URL exposed by `supabase start` (config.toml db.port = 54322).
LOCAL_DB_URL ?= postgresql://postgres:postgres@127.0.0.1:54322/postgres

help: ## 사용 가능한 명령 목록
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

setup: ## 신규 개발자 1회 셋업: 의존성 → Supabase 기동 → 마이그레이션 → 시드
	@command -v supabase >/dev/null 2>&1 || { echo "❌ supabase CLI 필요: brew install supabase/tap/supabase"; exit 1; }
	@docker info >/dev/null 2>&1 || { echo "❌ Docker가 실행 중이 아님. Docker Desktop을 켜세요."; exit 1; }
	pnpm install
	supabase start
	$(MAKE) migrate
	$(MAKE) seed
	@echo "✅ 셋업 완료. 'make dev'로 개발 서버를 시작하세요."
	@echo "   Supabase Studio: http://127.0.0.1:54323"

dev: ## 일상 개발: web + api (landing 제외 — 파일워처 줄여 macOS fd 한도 회피)
	@supabase status >/dev/null 2>&1 || supabase start
	@$(MAKE) migrate
	@$(MAKE) kill-dev
	pnpm exec turbo dev --filter=@haggle/web --filter=@haggle/api

dev-all: ## 전체(web+landing+api) 실행. 파일워처 3개 → macOS면 fd 한도 상향 필요할 수 있음
	@supabase status >/dev/null 2>&1 || supabase start
	@$(MAKE) migrate
	@$(MAKE) kill-dev
	pnpm dev

landing: ## landing(마케팅 사이트)만 단독 실행 (port 3002)
	@$(MAKE) kill-dev
	pnpm --filter @haggle/landing dev

kill-dev: ## dev 포트($(DEV_PORTS)) 점유 프로세스 정리 (이미 켜진 dev 끄기)
	@for p in $(DEV_PORTS); do \
		pids=$$(lsof -ti tcp:$$p 2>/dev/null); \
		if [ -n "$$pids" ]; then kill $$pids 2>/dev/null && echo "  freed port $$p ($$pids)"; fi; \
	done; true

migrate: ## 로컬 DB에 마이그레이션 적용 (pgvector 확장 보장 후 drizzle migrate)
	psql "$(LOCAL_DB_URL)" -f supabase/init-extensions.sql
	DATABASE_URL="$(LOCAL_DB_URL)" pnpm --filter @haggle/db db:migrate

migrate-new: ## 스키마 변경 후 새 마이그레이션 파일 생성 (drizzle generate)
	pnpm --filter @haggle/db db:generate

# 신규 개발자 baseline: 태그 분류체계(tag-garden) → 유저·리스팅 10개(test-data).
# 로컬/staging 전용 — prod 금지 (Playbook R3).
seed: ## fixtures 시드 (baseline: 태그 + 유저·리스팅 10개)
	DATABASE_URL="$(LOCAL_DB_URL)" pnpm --filter @haggle/api exec tsx src/scripts/seed-tag-garden.ts
	DATABASE_URL="$(LOCAL_DB_URL)" pnpm --filter @haggle/api exec tsx src/scripts/seed-test-data.ts

seed-full: seed ## baseline + 확장 시드 (유사도 테스트용 40유저·맥북 액세서리)
	DATABASE_URL="$(LOCAL_DB_URL)" pnpm --filter @haggle/api exec tsx src/scripts/seed-test-data-batch2.ts
	DATABASE_URL="$(LOCAL_DB_URL)" pnpm --filter @haggle/api exec tsx src/scripts/seed-macbook-accessories.ts

reset: ## 로컬 DB 초기화 + 재시드 (PR 머지 후 동기화)
	supabase db reset
	$(MAKE) migrate
	$(MAKE) seed

status: ## Supabase 로컬 스택 상태 + 접속 정보
	supabase status

stop: ## Supabase 로컬 스택 종료
	supabase stop

db-url: ## 로컬 DB 접속 URL 출력 (.env에 붙여넣기용)
	@echo "$(LOCAL_DB_URL)"
