# Medionary Auth — phases, OAuth requirements and tests

Run ONE phase at a time with the prompt file `/auth-phase` (it asks for the phase number).
The always-on rules (architecture, security, stack, brand) are in `.github/copilot-instructions.md`.
Source of truth for the database: `supabase/migrations/…_medionary_full.sql`.

## Google OAuth requirements
Flow (backend-driven, PKCE, no tokens in the browser):
- `GET /auth/google?next=/some/path` → generate `state` + PKCE verifier, keep them in a
  short-lived (≤10 min) httpOnly, Secure, SameSite=Lax cookie, call Supabase to get the Google
  authorization URL (server-side), respond with a 302 to it.
- Google → Supabase → our `GET /auth/google/callback?code=…&state=…` → verify `state`
  (reject mismatch), exchange the code for a session server-side, set the session cookies,
  clear the temp cookie, redirect to the web app.
- Redirect target: first-time/incomplete profile → `/onboarding`; otherwise the user's home.
  **`next` must be validated against an allow-list of relative paths** (no open redirect).
- On any failure redirect to `/login?error=oauth_failed` (generic, no details).
- **Account linking policy:** accept only Google accounts with a VERIFIED email. Same verified
  email as an existing account must not create a duplicate user. Read how Supabase handles
  identity linking, state the exact behaviour in Phase 0, and test it. Never link on an
  unverified email.
- A user created via Google is always a patient. Roles are never taken from Google data.
- Use the minimum scopes (`openid email profile`). Follow Google's current sign-in branding
  rules for the "Continue with Google" button, styled to fit our brand tokens otherwise.
- Because the PKCE verifier must survive between the two requests on a stateless server,
  design its storage explicitly (cookie-backed storage adapter or equivalent) and explain it.
- Keep provider identifiers/ids out of logs. Phone is optional for Google users for now;
  leave a clear TODO for requiring a verified phone before SOS/ambulance features.


## Phases
STOP after each phase, summarise, show lint/typecheck/test output, and wait for me to say
"continue". Ask before adding any dependency. Don't refactor unrelated code.

**Phase 0 — Orientation (no code).** Read `.github/copilot-instructions.md`, the SQL, the CSS and Tailwind config.
Reply with: (a) brand tokens found, (b) folder structure for both apps, (c) session design:
cookie names/flags, refresh, CORS + CSRF design, how Next.js learns the user's state (e.g. a
server-side call to our `GET /me`), (d) the OAuth design incl. PKCE storage and account-linking
behaviour, (e) all API endpoints (method, path, who may call), (f) env variable NAMES, (g)
conflicts/open questions.

**Phase 1 — Backend foundation.** Express + TS skeleton: helmet, CORS allow-list, cookies,
CSRF, body limits, express-validator + `validate` middleware, central error handler (no
stack traces/PII), pino with redaction, Redis rate limiter, `authenticate` middleware (read
the session cookie, verify the Supabase JWT per current docs, attach a user-scoped Supabase
client), `requireRole('admin')`, `requireAal2`, `requireHospitalStaff(hospitalId)` (checks the
`hospital_staff` table through the user-scoped client, not the JWT), `/health`.
Done when tests prove: 401 without cookie, 401 with tampered token, 403 for non-admin on an
admin route, 422 for invalid/unknown fields, 429 after the limit.

**Phase 2 — Frontend foundation.** shadcn/ui configured; brand tokens mapped into the theme;
typed API client (`fetch` with `credentials: 'include'`, CSRF header, central error handling);
TanStack Query; `.env.example` containing only the API base URL.
Done when: the app builds, shadcn components show brand colors, and a CI/grep check proves no
`supabase` import/URL/key exists in `FRONTEND_DIR`.

**Phase 3 — Email & password authentication.** API: `POST /auth/register`,
`POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me`. Registration and
login use Supabase email/password auth; access and refresh tokens are set only in httpOnly
session cookies. Login is rate-limited and returns a generic invalid-credentials response.
UI: `/login`, `/register/patient`, `/register/hospital`, logout.
Done when: password registration/login works end to end; the session survives refresh; logout
clears cookies.

**Phase 4 — Google OAuth.** Implement the 'Google OAuth requirements' above end to end (backend routes, PKCE storage,
`state` check, safe redirects, account-linking behaviour) and the "Continue with Google" button
on `/login` (a full-page navigation to `GET /auth/google`).
Done when: a Google user signs in, lands on `/onboarding` once, then on their home; tests cover
state mismatch → rejected, open-redirect attempt → blocked, missing `code` → generic error,
same verified email → no duplicate user, unverified email → not linked, cookie flags correct,
logs contain no `code`/`state`.

**Phase 5 — Onboarding.** API `PATCH /me` accepts ONLY `full_name`, `phone_e164`, `handle`,
`is_public` (unknown fields rejected), uses the user-scoped client, maps DB errors (reserved,
taken, bad format) to friendly codes. Do NOT build a public "is this handle taken" endpoint
(scraping risk) — just try the update. UI `/onboarding`: name, phone (optional for Google
users), handle, `is_public` toggle (default off, explain in plain words that patient profiles
are private by default). On success show the code as `PAT-XXXX-XXXX-XXXX-XX` with a copy button.
Done when: new users are sent through onboarding once; extra fields (`user_code`, `role`) are
rejected by tests.

**Phase 6 — Admin module (the ONLY place using the service-role key).**
`POST /admin/users/:id/role` (platform admin via `app_metadata`),
`POST /admin/doctors/:id/verify` (insert/update `doctors`, set `verification_status`,
`verified_by/at`, set `app_metadata.role='doctor'`),
`POST /admin/hospitals/:hospitalId/staff` (insert `hospital_staff`).
Each: authenticate → `requireRole('admin')` → `requireAal2` → validate → act → write
`audit_logs` → return minimal data. Leave an interface + TODO for the doctor KYC provider.
Done when: tests show patient/doctor tokens are rejected and every call writes an audit row.

**Phase 7 — MFA (TOTP) for doctors and admins.** API `POST /auth/mfa/enroll`,
`/auth/mfa/enroll/verify`, `/auth/mfa/challenge`, `/auth/mfa/verify` (Express calls Supabase MFA
and refreshes the cookie session to `aal2`). UI `/mfa/enroll` (QR + manual key + confirm code)
and `/mfa/challenge`. Doctors/admins are forced to enroll, then challenge; everything else is
blocked until `aal2` (this also applies to doctors/admins who signed in with Google). Patients
are not forced. Ask me for the lost-authenticator recovery policy.
Done when: a doctor test account at `aal1` cannot open `/doctor/*` or call doctor/admin APIs.

**Phase 8 — Role-based shell.** Protected layouts `/(patient)`, `/(doctor)`, `/(admin)`,
`/(hospital)` with a minimal nav and an empty dashboard each, in brand styling. Next.js decides
routing from our `GET /me` (server side) — UX only; real protection is the API + RLS. Show the
formatted code and handle in the header menu.
Done when: each role lands in its own shell, others get a 403 page, new users go to onboarding.

**Phase 9 — Security review (fresh pass).** Review the whole module against the always-on rules in
`.github/copilot-instructions.md` and the test list below. List findings by severity with file and line; fix the High ones. Do not
call anything "secure" without evidence.

## Tests that must exist before Auth is "done"
1. Logged-out users cannot call any API route except `/health` and the login/registration/OAuth endpoints.
2. Tampered or expired token/cookie → 401.
3. Patient A cannot read/update patient B's profile (changed ID → 403/404/0 rows).
4. A request that sets `user_code`, `role`, `verification_status` or any unknown field is
   rejected (422); the DB column grants would also block it.
5. A user cannot grant themselves `admin`/`doctor` (`user_metadata` is ignored).
6. Admin endpoints reject non-admin and `aal1` tokens; each success writes `audit_logs`.
7. Doctors/admins at `aal1` are blocked (including Google logins); patients are not forced into MFA.
8. Registration/login/OAuth endpoints return 429 after the limit; responses are identical for existing
   vs non-existing accounts.
9. OAuth: `state` mismatch rejected; open redirect blocked; no duplicate account for the same
   verified email; unverified email never linked; PKCE temp cookie is httpOnly, Secure,
   SameSite=Lax, short-lived and cleared after use.
10. CSRF: a state-changing request without the custom header or from a wrong Origin is rejected.
11. Browser isolation: CI check that `FRONTEND_DIR` has no `supabase` import/URL/key, and a
    Playwright test that the browser sends requests only to our API (and to Google during the
    OAuth redirect), never to `supabase.co`.
12. The service-role key appears only in the admin module and server env (grep/CI check).
13. Logs contain no tokens, passwords, phone numbers or OAuth `code`/`state` (test redaction).


If anything here conflicts with the current docs or the SQL, STOP and ask me.