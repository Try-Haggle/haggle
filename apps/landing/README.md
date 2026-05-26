# @haggle/landing

Marketing site for Haggle — deployed at **tryhaggle.ai**.

The web app lives separately at **app.tryhaggle.ai** (`apps/web`).

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

## Environment variables

Copy `.env.local.example` → `.env.local` and fill in:

| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_APP_URL` | URL of the web app — used for "Sign in" / "Get Started" links |

## Deployment

Deployed as a **separate Vercel project** from `apps/web`. See
[`docs/wip/Landing_Page_Implementation_Plan.md`](../../docs/wip/Landing_Page_Implementation_Plan.md)
for setup steps.
