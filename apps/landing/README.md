# @haggle/landing

Marketing site for Haggle — deployed at **tryhaggle.ai**.

The web app lives separately at **app.tryhaggle.ai** (`apps/web`).

---

## Local development

From repo root:

```bash
pnpm install                              # install workspace deps
pnpm --filter @haggle/landing dev         # http://localhost:3001
```

Or run both apps in parallel via turbo:

```bash
pnpm dev                                  # web on :3000, landing on :3001
```

### Build / typecheck

```bash
pnpm --filter @haggle/landing typecheck
pnpm --filter @haggle/landing build
pnpm --filter @haggle/landing start       # serve built output on :3001
```

---

## Environment variables

Copy `.env.local.example` → `.env.local` and fill in:

| Var | Local | Production | Purpose |
|-----|-------|------------|---------|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | `https://app.tryhaggle.ai` | URL of the web app — used for "Sign in" / "Get Started" links |

---

## Deployment (Vercel)

Deployed as a **separate Vercel project** from `apps/web`. The repo is a pnpm
monorepo, so a few project settings are non-default.

### One-time setup

1. **Vercel → Add New Project → Import** this repo.
2. **Project name**: `haggle-landing` (or whatever you prefer)
3. **Framework Preset**: Next.js (auto-detected)
4. **Root Directory**: `apps/landing` ← **important**
5. **Build & Output Settings**:
   - **Install Command**: `pnpm install --frozen-lockfile` (default)
   - **Build Command**: `pnpm --filter @haggle/landing build` (or leave default — Vercel detects `next build` inside the root directory)
   - **Output Directory**: `.next` (auto)
6. **Environment Variables**:
   - `NEXT_PUBLIC_APP_URL` = `https://app.tryhaggle.ai`
7. **Node.js Version**: 22.x (matches root `engines`)
8. Click **Deploy**.

> ℹ️ Vercel auto-detects pnpm from `pnpm-lock.yaml`. No extra config needed.

### Domain setup

After the first successful deploy:

1. Vercel project → **Settings → Domains → Add Domain** → `tryhaggle.ai`
2. Vercel will show DNS records to add at your registrar (Cloudflare /
   Namecheap / Squarespace / etc.):
   - **Apex (`tryhaggle.ai`)** → A record `76.76.21.21`
   - Or (recommended) delegate the entire zone to Vercel/Cloudflare
     nameservers and let them manage records
3. Wait a few minutes for DNS propagation + SSL issuance.
4. Vercel will mark the domain as "Valid Configuration" once it can verify.

### Incremental deploys

Vercel watches the GitHub repo. Every push to `main` triggers a build if the
diff touches `apps/landing/**` or shared dependencies (`packages/shared`,
root `package.json`, etc.). Touch-only commits elsewhere are skipped.

### Rollback

Vercel keeps every deploy. To roll back: project → **Deployments** →
hover the prior good deploy → **Promote to Production**.
