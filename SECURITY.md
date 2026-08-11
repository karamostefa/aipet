# Security measures implemented

Carried over from the original CAIA build, trimmed to what actually applies
to AIPeT (no payment webhooks here — see the note at the bottom).

## SQL injection
**Fully mitigated.** All database access goes through Prisma, which uses
parameterized queries exclusively — there is no string-concatenated SQL
anywhere in this codebase, so classic SQL injection isn't possible through
the application layer.

## Cross-Site Scripting (XSS)
- **Stored XSS**: free-text fields a student can submit (chat replies) are
  run through `sanitizeText()` (DOMPurify, strips all HTML/script tags)
  before they're saved — see `src/lib/security.ts`.
- **Reflected/DOM XSS**: React escapes all rendered content by default;
  this codebase does not use `dangerouslySetInnerHTML` anywhere.
- A strict **Content-Security-Policy** header (`next.config.js`) further
  limits which scripts/styles/frames can ever run on the page, even if
  something slipped through.

## Cross-Site Request Forgery (CSRF)
- Both the admin session cookie (`src/lib/auth.ts`) and the student session
  cookie (`src/lib/studentAuth.ts`) are set with `SameSite=Strict` and
  `httpOnly` — browsers will not attach them to cross-site requests, and
  client-side JS can never read them (blocking token theft via XSS too).
- The Chargily webhook doesn't rely on cookies/sessions at all — it's
  verified by cryptographic signature instead (below), which is immune to
  CSRF by construction.

## Payment webhook forgery
Anyone can `POST` to `/api/payments/chargily/webhook` pretending to be
Chargily. The handler verifies a cryptographic signature before trusting
the payload: HMAC-SHA256 over the raw body, compared with
`crypto.timingSafeEqual` (`src/lib/payments/chargily.ts`) — a timing-safe
comparison prevents an attacker from guessing the signature one byte at a
time. A student's subscription is only ever activated from inside this
verified handler — **never** from the `/aipet/subscribe/success` redirect
page, which is just a "thanks" screen the browser can revisit or fake at
will.

## Brute force / credential stuffing
- **Per-IP rate limiting**: both admin login and student login are capped
  at 5 attempts/minute/IP (`src/lib/security.ts`, via Upstash Redis).
- **Per-ACCOUNT lockout** (`src/lib/accountLockout.ts`): after 5 wrong
  passwords in a row *for the same account*, it locks for 15 minutes —
  regardless of which IP the attempts came from. This is what actually
  stops credential stuffing, since an attacker rotating across many IPs
  defeats per-IP rate limiting but not per-account lockout. A correct
  password always resets the counter.
- Passwords are hashed with bcrypt (cost factor 12) — never stored in
  plaintext, never reversible.
- Login failures return an identical, generic error whether the email
  exists or not, so an attacker can't enumerate accounts.

## Spam / abuse of public forms
Signup, submission, and reply endpoints are all rate-limited
(10 requests/minute/IP) separately from login, so a scripted spammer can't
flood the tutor's Anthropic API usage or the database.

## Denial of service via oversized uploads
`/api/aipet/submissions` caps incoming base64 photo data at ~12MB (roughly
a 9MB photo) — `MAX_IMAGE_BASE64_CHARS` in that route. Without this, any
authenticated student (or a stolen session) could send arbitrarily large
request bodies repeatedly, exhausting server memory/disk and driving up
Google Vision/storage costs. Server Actions body size is separately capped at
the framework level in `next.config.js` as defense in depth, even though
this app doesn't currently use them.

## Transport security
- `Strict-Transport-Security` (HSTS) header forces HTTPS for two years,
  including subdomains.
- All cookies are `Secure` in production (HTTPS-only).

## Other headers (`next.config.js`)
- `X-Frame-Options: DENY` — the site can't be embedded in a hidden iframe
  for clickjacking.
- `X-Content-Type-Options: nosniff` — stops MIME-sniffing attacks.
- `Referrer-Policy: strict-origin-when-cross-origin` — avoids leaking full
  URLs (which can contain tokens) to third-party sites via the Referer header.
- `Permissions-Policy` disables camera/microphone/geolocation site-wide.
- The Content-Security-Policy's `script-src` includes `'unsafe-eval'` **only
  when `NODE_ENV !== 'production'`** — React's dev-mode tooling (component
  stack traces, Fast Refresh) genuinely needs `eval()` and throws a console
  error without it; production React never calls `eval()`, so the real,
  deployed CSP (`npm run build && npm start`) never includes this and stays
  fully strict.

## Fail loud, not silent
Every API route is wrapped with `withApiHandler` (`src/lib/apiHandler.ts`).
An uncaught exception anywhere — a DB connection issue, a missing env var,
a third-party API outage — is always (a) logged server-side with full
detail, and (b) returned to the browser as clean, readable JSON, never a
raw error page. This exists because the previous behavior (an unwrapped
DB call throwing straight through) is exactly what made a real signup
failure look like "nothing happened," with no subscriber row created and
no error visible anywhere — see `src/lib/env.ts` too, which now warns
loudly on startup about missing/placeholder config instead of failing
cryptically later.

## Dependency vulnerabilities
`npm audit` is checked as part of maintaining this project — as of this
build: `next` is pinned to 14.2.35 (14.2.5, the original pin, had a known
vulnerability — see the `npm install` warning if you ever see it again)
and `nodemailer` is pinned to 9.0.5 (6.9.14 had several SMTP-injection/SSRF
advisories). One remaining `npm audit` finding — an advisory about Next.js
Server Functions/Actions — doesn't apply here: this codebase has zero
`'use server'` usage anywhere (grep for it if you want to confirm), so
that attack surface doesn't exist in this app. Re-run `npm audit` after
any future `npm install` — dependency advisories are discovered
continuously, not just at build time.
Every API route validates its input against a strict schema (Zod) before
touching the database — see the `*Schema` definitions in `src/lib/security.ts`.
Anything that doesn't match the expected shape is rejected with a 400,
before it ever reaches Prisma or business logic.

## Authentication & sessions
- Both admin and student sessions are signed JWTs (using `jose`, not
  `jsonwebtoken` — see below), verified on every request.
- A tampered or expired token always fails closed (treated as "not logged in").
- **The primary enforcement point for admin pages is the layout, not
  middleware.** `src/app/admin/(dashboard)/layout.tsx` — an async Server
  Component — calls `getCurrentAdmin()` and redirects to `/admin/login`
  if there's no valid session, for every page nested under it (Modules,
  Units, Exercises, Pricing, Students, Payments, Dashboard). This always
  runs in the Node.js runtime, so it's guaranteed to execute correctly.
  `middleware.ts` is a second, faster layer on top (redirects before the
  page even starts rendering) but is not relied on as the only gate.
- `/admin/login` deliberately sits *outside* that layout's route group
  (the `(dashboard)` folder) so it never gets wrapped in the authenticated
  sidebar UI — visiting it while logged out shows only the login form.
- Every `/api/admin/*` route independently calls `requireAdmin()` too,
  since API routes are called directly (fetch) and don't go through
  page-level layouts at all.

### Why `jose`, not `jsonwebtoken`
Earlier revisions used `jsonwebtoken` for both admin and student sessions,
including inside `middleware.ts`. That's a real, well-known trap: Next.js
Middleware runs on the **Edge Runtime**, which doesn't reliably support
`jsonwebtoken` (it depends on Node's `crypto` module). In practice this
meant the admin-panel auth check in middleware could not be trusted to
run correctly — which is exactly why the dashboard layout above is the
real gate, not middleware alone. Both `src/lib/auth.ts` and
`src/lib/studentAuth.ts` now use `jose` instead, which uses the standard
Web Crypto API and works identically in both the Edge Runtime and the
Node.js runtime — removing this class of bug rather than just working
around one instance of it.

### Why the `Secure` cookie flag is derived from the request, not `NODE_ENV`
Both session cookies are `httpOnly` + `sameSite: strict` always, and
`secure` whenever the connection is actually HTTPS. Earlier revisions
computed that last flag from `process.env.NODE_ENV === 'production'`.
That's fragile: if `NODE_ENV` is wrong for a given environment (a
system-wide `NODE_ENV=production` left set on a machine, a misconfigured
host, etc.), the cookie gets marked `Secure` even on a plain HTTP
connection — and browsers correctly, silently refuse to store a `Secure`
cookie over HTTP. The result looks exactly like "login does nothing":
the server reports success and even sets the header, but the browser
just discards it, so every subsequent page load looks logged-out again.
Critically, most command-line HTTP clients (curl, PowerShell's
`Invoke-WebRequest`) don't enforce this the same way browsers do, so a
bug like this can pass every backend/API-level test while failing in
every real browser — which is exactly what happened here. `requestIsHttps()`
in `src/lib/auth.ts` / `src/lib/studentAuth.ts` now checks the actual
incoming request's protocol (and the standard `x-forwarded-proto` header
for when the app sits behind a reverse proxy/host like Vercel), so the
flag always matches reality regardless of environment configuration.

## Not applicable to this extraction
Stripe's webhook verification (`stripe.webhooks.constructEvent`) isn't
included here — this build only integrates Chargily (Algeria-focused
EDAHABIA/CIB/BaridiMob), per the extraction request. Add
`src/lib/payments/stripe.ts` back the same way if you need international
cards later; keep the same rule — verify webhook signatures
cryptographically, never trust an unauthenticated `POST` to mark something
paid.
