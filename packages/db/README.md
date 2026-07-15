# @haggle/db

Haggle은 환경별로 하나의 PostgreSQL을 사용하고 결제, 배송, 분쟁을 논리 장부로 분리한다.

- 사람이 먼저 보는 영역/테이블 지도: [database-catalog.md](../../docs/mvp/database-catalog.md)
- 변경 승인, migration, 기존 DB 호환 규칙: [database-structure-and-governance.md](../../docs/mvp/database-structure-and-governance.md)
- ORM 모델: [`src/schema`](./src/schema)
- 배포 migration: [`drizzle`](./drizzle)
- raw SQL 소유권: [`schema-ownership.json`](./schema-ownership.json)
- 관리 관계 목록: [`transaction-relations.json`](./transaction-relations.json)

새 에이전트는 catalog에서 영역을 찾은 뒤 schema, migration, 실제 API writer 순서로 확인한다. 문서만 보고 컬럼이나 관계를 추측하지 않는다.

```bash
pnpm verify:migrations
pnpm verify:db-invariants
pnpm db:preflight:compat
pnpm db:audit:relations
```
