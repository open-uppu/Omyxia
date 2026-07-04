# Omyxia Admin Console

> **admin.omyxia.app** — super_admin-only SPA for the Omyxia platform.

This app is the v2.0.0 Tier-1 admin console. It runs on a separate
origin from the tenant app (`app.omyxia.app`) and uses its own JWT
cookie (`admin_session`) so a tenant session is never authorised to
touch admin routes.

## Stack

- **Next.js 14** (app router, server components + client components)
- **React 18**
- **Tailwind CSS** with shadcn/ui-style design tokens
- **lucide-react** icons
- **jose** for JWT signing/verification (Edge + Node compatible)
- **vitest** + **@testing-library/react** for tests

## Project layout

```
apps/admin-console/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # root <html>/<body> + metadata
│   │   ├── globals.css             # Tailwind layers + theme tokens
│   │   ├── login/page.tsx          # public — LoginForm
│   │   ├── (app)/                  # protected route group
│   │   │   ├── layout.tsx          # server-side cookie verification
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── tenants/page.tsx
│   │   │   ├── plans/page.tsx
│   │   │   ├── audit/page.tsx
│   │   │   └── settings/page.tsx
│   │   └── api/auth/
│   │       ├── login/route.ts      # POST: dev bootstrap OR proxy
│   │       ├── logout/route.ts     # POST: clear cookie + best-effort backend
│   │       └── me/route.ts         # GET:  verified current user
│   ├── components/
│   │   ├── auth/LoginForm.tsx
│   │   ├── layout/AdminShell.tsx   # sidebar + topbar + mobile nav glue
│   │   ├── layout/Sidebar.tsx      # left nav
│   │   ├── layout/Topbar.tsx
│   │   ├── layout/UserMenu.tsx
│   │   ├── layout/MobileNav.tsx
│   │   └── ui/                     # Button, Input, Label, Card, Badge
│   ├── lib/
│   │   ├── auth.ts                 # client-side cookie helpers
│   │   ├── jwt.ts                  # jose wrapper (sign + verify)
│   │   ├── constants.ts            # NAV_ITEMS
│   │   └── utils.ts                # cn, formatDateTime, initialsOf
│   └── middleware.ts               # Edge auth gate
├── package.json
├── tailwind.config.ts
├── next.config.js
├── vitest.config.ts
└── .env.example
```

## Auth model

1. The user lands on `/login` (or any admin route, which middleware
   redirects to `/login`).
2. They POST `{ email, password }` to `/api/auth/login` (same origin).
3. In **dev mode** (`ADMIN_DEV_MODE=true`) the route mints a JWT for the
   hard-coded bootstrap user (`admin@omyxia.app` / `admin`) using
   `ADMIN_JWT_SECRET`. In production (`ADMIN_DEV_MODE=false`) it proxies
   to the backend's `/admin/auth/login` (P1.3).
4. The frontend stores the JWT in a non-HttpOnly cookie
   `admin_session` (Path=/, SameSite=Strict, Secure when HTTPS).
5. Middleware re-verifies the JWT on every navigation. Expired or
   missing cookies → `/login`. Wrong role → `/login?reason=forbidden`.
6. Every protected page also re-verifies server-side in
   `app/(app)/layout.tsx` as defence in depth.

### Token shape (HS256, signed by `ADMIN_JWT_SECRET`)

```json
{
  "sub":   "<admin-user-uuid>",
  "email": "admin@omyxia.app",
  "name":  "Bootstrap Admin",
  "role":  "super_admin",
  "iss":   "omyxia-admin",
  "aud":   "admin.omyxia.app",
  "iat":   1783167000,
  "exp":   1783195800
}
```

`role` is enforced — anything other than `super_admin` is bounced.

## Local development

```bash
cd apps/admin-console
cp .env.example .env.local
pnpm install
pnpm dev          # http://localhost:3001
```

Then visit <http://localhost:3001/login> and sign in with
`admin@omyxia.app` / `admin`.

```bash
pnpm test         # vitest unit + component tests
pnpm type-check   # tsc --noEmit
pnpm build        # next build
```

## Roadmap

This card (P2.1) ships the **shell** only. The following cards fill in
the data + interactions:

- **P2.2** — Dashboard metrics (tenants, MRR, storage, API volume)
- **P2.3** — Tenant list (search, filter, pagination, actions)
- **P2.4** — Tenant detail (users, plan, usage, impersonate)
- **P2.5** — Plan management (create/edit plans + add-ons + price)
- **P3.2** — Hide menu + route guard by entitlements
- **P3.4** — Upgrade plan modal when access denied

## Security notes

- **Standalone origin**: the admin app never reads tenant cookies and
  never sends them to the backend. A tenant user cannot escalate.
- **No tokens in URL**: JWT lives in a cookie, never in `?token=…`.
- **Defence in depth**: both middleware (Edge) and `(app)/layout.tsx`
  (Node) verify the JWT on every request. If either fails, the request
  is rejected.
- **CSP-friendly**: no inline scripts, no eval, no third-party fonts
  loaded by default. Security headers set in `next.config.js`.