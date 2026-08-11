# AIPeT — AI Pedagogical Tutor

Standalone website for **AIPeT**, extracted from the CAIA codebase. AIPeT is
an AI-assisted pedagogical tutor for Algerian high-school students: a
student solves an exercise by hand, photographs it, and AIPeT analyzes the
*reasoning* — never handing over the final answer — and asks Socratic
questions to guide the student back onto the right path.

This is a **complete, independent project**: its own Next.js app, its own
database schema, its own admin console. It shares no code or database with
the rest of CAIA (products, books, trainings, payments) — none of that is
included here.

> **If you tried this before and signup silently did nothing:** that was
> a real bug — a database call wasn't wrapped in error handling, so any DB
> hiccup failed silently with no subscriber created and no visible error.
> It's fixed now (`src/lib/apiHandler.ts` wraps every API route), see
> "Try it right away" below to confirm it end-to-end.

## Stack

- **Framework:** Next.js 14 (App Router) + TypeScript, bilingual (EN/AR,
  with automatic RTL for Arabic)
- **Database:** PostgreSQL via Prisma (`prisma/schema.prisma`)
- **AI tutor:** Anthropic Claude API (`src/lib/tutor.ts`)
- **Handwriting OCR:** Google Cloud Vision (`src/lib/ocr.ts`) — optional; if not
  configured, students can type their work instead of photographing it
- **Auth:** custom JWT + httpOnly cookies, two independent sessions
  (`src/lib/studentAuth.ts` for students, `src/lib/auth.ts` for admins) — no
  next-auth, no third-party auth provider
- **Email:** Nodemailer/SMTP, for account activation links
- **Storage:** local disk out of the box (`src/lib/storage.ts`), designed to
  be swapped for Supabase Storage / S3-compatible storage in one function
- **Rate limiting:** Upstash Redis (optional — skipped gracefully if not
  configured)

## What's included

**Student-facing site** (`src/app/[locale]/aipet/*`)
- Landing page + sign-up form → email activation → set password → login
- Dashboard: modules → units, with progress bars
- Exercise page: photograph or type your work → AIPeT's Socratic analysis
  → follow-up chat → mark exercise as solved

**Subscriptions & payments** (`src/lib/subscription.ts`, `src/lib/payments/chargily.ts`)
- Every activated student gets a **7-day free trial**, starting the moment
  they set their password (not at signup, so a slow-to-click activation
  email doesn't burn trial days).
- Three plans, priced in DZD: **Monthly 800**, **Trimester (3mo) 2,100**,
  **Annual 7,500** (`src/lib/subscription.ts` — `PLAN_PRICES_DZD`).
- Payment goes through **Chargily Pay** (EDAHABIA / CIB / BaridiMob),
  settling to a CCP/bank account — the same gateway the original CAIA
  pricing plan called for.
- `/aipet/subscribe` shows the three plans; picking one creates a
  `AipetPayment` row and a Chargily checkout, then redirects the student
  to Chargily's hosted payment page.
- **A subscription only ever activates from a verified Chargily webhook**
  (`/api/payments/chargily/webhook`) — never from the success-page
  redirect, which a browser could revisit or fake. The webhook checks an
  HMAC-SHA256 signature before trusting anything.
- Renewals **stack** on top of remaining time rather than resetting the
  clock — paying a few days early never costs a student time they already
  paid for.
- The dashboard, unit pages, exercise pages, and every submission-related
  API route all check `checkAccess()` / `requireActiveStudent()` — access
  is enforced server-side, not just by hiding a link.

**Admin console** (`src/app/admin/*`, `src/app/api/admin/*`)
- Login (separate session/cookie from students)
- CRUD for Modules → Units → Exercises (statement, official solution,
  step-by-step breakdown, key concepts, common mistakes — all bilingual)
- **Students** page: every subscriber with live trial/subscription status
- **Payments** page: every `AipetPayment`, with total revenue collected
- Dashboard with live counts (modules, units, exercises, paid subscribers,
  trialing students, total revenue, submissions, resolved exercises)

**Database** (`prisma/schema.prisma`, mirrored in `database/schema.sql`)
- `Admin`, `AipetSubscriber` (now with trial/subscription fields),
  `AipetModule`, `AipetUnit`, `AipetExercise`, `Submission`,
  `TutorSession`, `Progress`, `AipetPayment`

## Getting started

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL, JWT_SECRET — see below for what's optional
npx prisma generate
npm run db:push           # creates tables from prisma/schema.prisma
npm run db:seed           # creates an admin account + default pricing + 2 units / 5 real exercises
npm run dev
```

Then:
- Student site: http://localhost:3000
- Admin console: http://localhost:3000/admin/login
  (credentials printed by `db:seed` — **change the password immediately**)

### Connecting to Supabase (fixes `P1001: Can't reach database server`)

If `npm run db:push` fails with `P1001` against a `db.<ref>.supabase.co`
host, you're hitting Supabase's IPv6-only direct connection on a network
without IPv6 (most home/office networks) — not a problem with this code
or your credentials. Fix:

1. Supabase dashboard → your project → **Project Settings → Database →
   Connection string** → click the **"Connection pooling"** tab (not
   "Direct connection", which is the one that just failed).
2. Copy the **Transaction mode** URI (port `6543`) into `DATABASE_URL`,
   and the **Session mode** URI (port `5432`, same host) into
   `DIRECT_URL`. Both look like
   `postgresql://postgres.<ref>:[password]@aws-0-<region>.pooler.supabase.com:PORT/postgres`
   — full template with comments in `.env.example`.
3. Make sure `DATABASE_URL` ends in `?pgbouncer=true` (needed for the
   transaction pooler) — `DIRECT_URL` should NOT have that flag.
4. Re-run `npm run db:push`.

This also matters for the *deployed* app, not just local setup — if your
production host's network can't reach IPv6 either, the direct connection
string would fail there too. The pooled connection is IPv4-compatible and
is what Supabase recommends for app runtime anyway (better connection
reuse under load).

If it's still not connecting after switching to the pooler: check the
project isn't paused (Supabase free-tier projects pause after ~1 week
idle — there's a one-click "Restore" button on the dashboard if so), and
double check the password in the URL doesn't contain unescaped special
characters (`@`, `#`, `/`, etc. need URL-encoding).

### "Can't reach database server" that comes and goes (not the setup error above)

If `db:push` succeeded and the app worked, but a page occasionally throws
`Can't reach database server at ...pooler.supabase.com:6543` afterward,
that's usually PgBouncer connection exhaustion, not an outage. Supabase's
pooler already manages a limited pool of connections; Prisma opens its
own pool on top by default (sized to your CPU core count), and the two
can conflict under Supabase's free-tier connection limits — especially
after a long dev session with lots of hot-reloading. Add
`&connection_limit=1` to the end of `DATABASE_URL` (see `.env.example`)
to make Prisma use a single connection through the pooler instead of its
own pool — this is Prisma's own documented recommendation for exactly
this setup.
double check the password in the URL doesn't contain unescaped special
characters (`@`, `#`, `/`, etc. need URL-encoding).

### Try it right away, before configuring any paid API keys
With only `DATABASE_URL` and `JWT_SECRET` set, you can walk through the
**entire student flow today**: sign up → grab the activation link (see
below) → set a password → land on the dashboard with a live 7-day trial →
pick an exercise → type your work (photo upload needs Google Vision, typing
doesn't) → get a tutoring reply → mark it solved → see it on your progress
dashboard. Two things run in a graceful fallback mode until you add real
keys, and both say so clearly:
- **No `ANTHROPIC_API_KEY`** → the tutor replies with a Socratic-style
  canned response prefixed `[DEMO MODE — set ANTHROPIC_API_KEY for real AI
  analysis]`, so you can test the full UI/DB flow before paying for API
  access. Real analysis obviously needs a real key before launch.
- **No `GOOGLE_VISION_API_KEY`** → the exercise page's "type my work"
  option still works; only photo OCR needs Google Vision.
- **No `SMTP_*`** → the activation email won't send, but the subscriber
  row is still created and the activation link is always printed to your
  server console (`[AIPeT signup] ... activation link: ...`) *and* visible
  in `/admin/aipet/students` with a one-click "Copy activation link" /
  "Resend email" action — so you're never stuck without a way to activate
  a test account.

### Required env vars to actually get AIPeT working end-to-end
- `DATABASE_URL` / `DIRECT_URL` — any Postgres host (Supabase, Railway,
  Neon, self-hosted). On Supabase specifically, see "Connecting to
  Supabase" above — using the wrong connection string is the #1 cause of
  setup issues. If these are missing/wrong, `src/lib/env.ts` prints a
  clear warning to your server logs on startup rather than failing
  silently deep in a route.
- `JWT_SECRET` — `openssl rand -base64 32`
- `ANTHROPIC_API_KEY` — from console.anthropic.com. Without it, AIPeT runs
  in DEMO MODE (see above) instead of doing real AI analysis.
- `SMTP_*` — for activation emails (any provider; Gmail app-password works
  fine for testing). Without it, use the admin panel's activation-link
  copy/resend instead (see above).
- `CHARGILY_SECRET_KEY` / `CHARGILY_WEBHOOK_SECRET` — from your Chargily
  merchant dashboard. Without these, students still get their 7-day trial,
  but `/aipet/subscribe` will fail to create a checkout once it ends. You
  also need to register `https://yourdomain.com/api/payments/chargily/webhook`
  as the webhook endpoint in the Chargily dashboard — that's what actually
  flips a student from TRIALING/EXPIRED to ACTIVE after they pay.

Optional:
- `GOOGLE_VISION_API_KEY` — handwriting OCR (see above; general-purpose,
  not math-specialized — see src/lib/ocr.ts for the tradeoff vs. Mathpix).
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — rate limiting.
  Safe to leave blank for local dev; just don't skip it in production
  (per-account lockout in `src/lib/accountLockout.ts` still works without
  Redis — only the per-IP rate limiter needs it).

## Deploying

- **App:** Vercel is the path of least resistance for Next.js. If you do,
  switch `src/lib/storage.ts` to Supabase Storage / S3 first — Vercel's
  filesystem isn't persistent across instances, so local-disk uploads will
  disappear.
- **Database:** Supabase, Railway, or Neon Postgres all work as-is.

## Admin — what's controllable

Everything below lives at `/admin` (own login, separate from student
sessions):
- **Modules → Units → Exercises**: full CRUD, bilingual, draft/published/
  archived status.
- **Pricing** (`/admin/aipet/pricing`): the 3 plan prices (DZD), editable
  any time — checkout always uses the live DB value, never a hardcoded
  number. Changing a price never retroactively changes what an
  already-paying student was charged.
- **Students** (`/admin/aipet/students`): every subscriber, real-time
  trial/subscription status, and — for anyone stuck on "pending
  activation" — a one-click way to copy their activation link or resend
  the email.
- **Payments** (`/admin/aipet/payments`): every Chargily transaction and
  total revenue collected.

## What was intentionally left out of this extraction

This is AIPeT only — the rest of the original CAIA site (Products, Books,
Trainings, Stripe payments, the public "about/contact" pages) was
deliberately **not** copied over, per the extraction request. AIPeT's own
subscription billing (Chargily, DZD pricing, 7-day trial) *is* wired up —
see the "Subscriptions & payments" section above. International/Stripe
payments were left out since the target audience is Algerian high-school
students paying by EDAHABIA/CIB/BaridiMob; add `src/lib/payments/stripe.ts`
back the same way if you ever need USD/international cards too.

## Notes carried over from the original build

- The tutor's system prompt (`src/lib/tutor.ts`) is deliberately strict:
  it will not reveal the final answer or full solution under any framing,
  even direct requests — it only diagnoses reasoning and asks guiding
  questions.
- Admins never let students see `officialSolutionEn/Ar` or
  `solutionStepsEn/Ar` — those fields are only ever read server-side when
  building the prompt sent to Claude.
- `docs/AIPeT_6_Day_Plan.md` is kept for historical/planning context; it's
  documentation, not code.
