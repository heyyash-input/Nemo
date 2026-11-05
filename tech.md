# Nemo: technical implementation

This guide describes the current source code. Read [flow.md](flow.md) for the user journey and detailed JWT flow. Versions below identify the major versions declared in `package.json`; `package-lock.json` records exact installed dependencies.

## API flow images by role

See the [role diagram gallery](docs/api-flows/README.md) for Employee, Manager, Finance, and Administrator API flows. Each image is available as PNG and SVG.

## 1. Architecture and technology stack

Nemo is a React single-page application, one Express backend, and MongoDB persistence. It currently has one company policy and four roles, without company/tenant isolation.

### Frontend

- **React 19:** components, state, forms, dashboards, and account screens.
- **TypeScript 5:** checks frontend types at build time; interfaces are in `src/types.ts`.
- **Vite 7:** development server, API proxy, and production bundling.
- **React Router 7:** browser navigation and role-aware page routing.
- **Material UI 7 and Emotion 11:** controls, dialogs, theme, and styling.
- **Lucide React:** icons.
- **Browser fetch:** JSON and multipart requests through `src/api.ts`.

### Backend

- **Node.js:** runtime; package.json requires Node 20.19 or later. The Dockerfile uses Node 22.
- **Express 5:** API routes and middleware. Backend files are JavaScript ES modules (`.mjs`).
- **Mongoose 8:** database connections, schemas, queries, and indexes.
- **Zod 4:** runtime request validation. Frontend TypeScript types cannot validate incoming HTTP requests.
- **bcryptjs 3:** password hashing; signup/password changes use cost 12.
- **jsonwebtoken 9:** HS256 JWT signing and verification.
- **cookie-parser 1:** reads incoming cookies.
- **express-rate-limit 8:** authentication throttling.
- **Helmet 8:** security headers and content security policy.
- **Multer 2:** receipt uploads buffered in memory before storage.
- **dotenv 17:** reads local `.env` settings.
- **Node crypto:** SHA-256 token hashing and random identifiers/key material.

### Database and tooling

MongoDB Atlas hosts the database. MongoDB Compass is a client for viewing records, not the database server. Mongoose connects to `MONGODB_URI` and reuses driver connections.

`mongodb-memory-server` starts a real temporary MongoDB process for tests. It is also an explicitly enabled local demo fallback with persistent `.data/mongo` storage. It is not SQLite and is absent from the production runtime image.

Docker packages the app and dependencies; Compose runs its `nemo` service using the root `.env`. PowerShell and uv supply the Windows command environment. The application does not have a Python backend.

## 2. Source map and reading order

1. `src/main.tsx`: mounts React and providers.
2. `src/App.tsx`: session restoration, shared workspace data, navigation, route access, logout.
3. `src/AuthPage.tsx`: signup, password login, development demo shortcuts.
4. `src/api.ts`: API helpers, error conversion, formatting, CSV generation.
5. `src/expenses.tsx`: claim editor, receipt uploads, details, review, reimbursement dialogs.
6. `src/pages.tsx`: dashboard, lists, policy, transactions, audit, account settings.
7. `src/users.tsx`: administrator account management.
8. `src/components.tsx`, `src/styles.css`, `src/types.ts`: shared UI, styling, types.
9. `server/dev.mjs`: starts Vite and the backend for development.
10. `server/index.mjs`: initializes configuration/database/indexes and starts/stops HTTP.
11. `server/config.mjs`: parses environment settings and rejects invalid production configuration.
12. `server/app.mjs`: authentication, permissions, routes, uploads, errors.
13. `server/domain.mjs`: input schemas, default policy, policy checking, journal entries.
14. `server/models.mjs`: database schemas and indexes.
15. `server/database.mjs`: configured database and optional development fallback lifecycle.
16. `server/seed.mjs`: policy and explicitly enabled demo setup.
17. `server/create-admin.mjs`: initial administrator bootstrap.
18. `server/tests/`: isolated API and frontend utility tests.

## 3. Database records

### User

Name, unique normalized email, password hash, role, department, optional manager ID, active flag, timestamps. Ordinary queries exclude the password hash; login explicitly selects it for verification. Plaintext passwords are not stored.

### Session

Unique SHA-256 hash of the full JWT, user ID, and expiry. The complete token lives in the browser cookie. The expiry index cleans up old records, while request handling checks expiry immediately. This collection supports logout and account-wide session revocation.

### Claim

Expense number, owner, manager, title, purpose, INR currency, items, calculated total, status, submitted time, policy snapshot, submitted receipt reservations, history, optional settlement, timestamps, and `__v` version.

Items store category, date, merchant, description, integer amount in paise, and optional receipt ID/name. Settlement embeds the payment method/date/reference, transaction number, amount, recorder, recording time, and debit/credit entries. Reimbursements are not a separate collection.

### Receipt

Owner, sanitized filename, MIME type, size, binary contents, timestamps. File bytes are excluded from ordinary queries and explicitly selected for downloads. There is no external object-storage integration.

### Policy

Single company policy containing the claim-total cap, receipt threshold, submission window, category names, per-line category limits, account mappings, and version. Submitted claims preserve a snapshot.

### AdminAudit

Administrator actor ID/name, action, details, and timestamps. Claim events remain inside claims; the audit route merges both sources.

Indexes include unique user email, claim number, session token hash, and policy key; claim owner/status indexes; session expiry; and a unique sparse submitted-receipt index. Mongoose normally pluralizes model names into collections such as `users`, `sessions`, and `claims`.

## 4. API conventions

Application endpoints begin with `/api`. Requests/responses use JSON except receipt uploads/downloads. `:id` placeholders represent MongoDB ObjectId strings.

Write requests require `X-App-Request: ledgerly`. This legacy internal value remains in both client and server; changing it to `nemo` in a request would currently fail. It is not a secret or authentication token. When Origin is present, it must match APP_ORIGIN. General cross-origin API access is not configured.

Protected requests use the `session` cookie rather than an Authorization bearer header. The API helper lets the browser send cookies and set multipart boundaries automatically.

### Public and authentication endpoints

- `GET /api/health`: MongoDB readiness; returns HTTP 200 or 503.
- `GET /api/config`: public demo availability and INR currency.
- `POST /api/auth/signup`: `name`, `email`, `department`, `password`; creates an Employee, sets a JWT cookie, returns HTTP 201 and public profile.
- `POST /api/auth/login`: `email`, `password`; checks credentials and sets a JWT cookie.
- `POST /api/auth/demo`: `role`; registered only when demo is enabled outside production.
- `POST /api/auth/logout`: deletes the presented session and clears the cookie; repeat logout is safe.
- `GET /api/auth/me`: authenticated profile.
- `POST /api/auth/password`: authenticated `currentPassword`, `newPassword`; changes hash and revokes all user sessions.

Signup/login/demo share one rate limiter: 30 requests per 15 minutes per client IP. Its store is in process memory, so separate replicas do not share counters.

### People and policy endpoints

- `GET /api/users`: Admin; lists users.
- `POST /api/users`: Admin; accepts name, email, password, role, department, optional managerId/active. An Employee created through this route requires an active reporting manager.
- `PUT /api/users/:id`: Admin; updates profile/access and revokes sessions. Guards prevent self-removal of Admin access and invalid manager deactivation/reassignment.
- `GET /api/policy`: any authenticated account.
- `PUT /api/policy`: Admin; policy fields plus `version`, matching stored `__v`.

### Claim endpoints

- `GET /api/claims`: authorized claim list based on role and ownership/manager relationship.
- `GET /api/claims/:id`: one visible claim.
- `POST /api/claims`: creates the authenticated user's draft from title, purpose, and items.
- `PUT /api/claims/:id`: owner only, draft/rejected only; claim input plus `version`.
- `POST /api/claims/:id/submit`: owner only, draft only; checks manager, policy, and receipt reuse.
- `POST /api/claims/:id/decision`: Manager or Finance; `decision` (approve/reject) and optional `note`. Finance uses approve to move manager_approved to finance_verified.
- `POST /api/claims/:id/settle`: Finance; `date` (YYYY-MM-DD), `method` (Bank transfer, UPI, Cash), `reference`.

Example draft request, without a receipt attached yet:

```json
{
  "title": "Client meeting travel",
  "purpose": "Train journey to meet the client team",
  "items": [
    {
      "category": "Travel",
      "date": "2026-11-05",
      "merchant": "Railways",
      "description": "Return journey",
      "amountMinor": 125050
    }
  ]
}
```

This represents INR 1,250.50. Use a current valid date and attach a receipt ID before submission if required by policy. The backend chooses the owner, number, status, and calculated total. Claim creation permits 1–20 lines; policy limits are checked at submission.

### Receipt and audit endpoints

- `POST /api/receipts`: authenticated multipart upload; one `receipt` file, PDF/PNG/JPEG, maximum 5 MiB.
- `GET /api/receipts/:id`: permission-checked attachment download.
- `GET /api/audit`: Admin; combines claim and administrative events, newest first, up to 300 returned events.

There is no DELETE user/claim route, refresh-token endpoint, external payment endpoint, OTP endpoint, or CSV API. CSV exports are generated in the browser from authorized data.

### Error responses

Errors contain `message` and sometimes a `details` array:

- 400: invalid input, missing manager, invalid action details.
- 401: missing/expired/revoked/invalid authentication.
- 403: role, action, request-header, or origin denied.
- 404: unknown route/resource or inaccessible claim/receipt.
- 409: duplicate data, stale version, conflicting workflow state.
- 422: submission/policy failure.
- 429: authentication rate limit exceeded.
- 500: unexpected server error; internal details are withheld.

## 5. Authentication implementation

JWT uses HS256 and JWT_SECRET. Claims are sub (user ID), jti (unique token ID), iss (nemo), aud (nemo-web), iat, and exp. The token expires after 15 minutes, including during active use. No refresh token exists.

The HttpOnly, SameSite=Strict cookie is scoped to `/api`; Secure is added in production. The backend verifies the signature, allowed algorithm, issuer, audience, expiry, required claim shape, database session, and active user. Permissions use the current MongoDB role.

Logout deletes the matching session. Password changes and administrator account updates revoke all sessions for that user. Changing the signing key invalidates old JWT signatures. Read [flow.md](flow.md) for the request-by-request explanation.

## 6. Configuration and secrets

Local Node and Compose use the single root `.env`, ignored by Git and excluded from the Docker build context. Real credentials must never be copied into these documents.

- **MONGODB_URI:** database connection string and target database. Required for ordinary operation/production.
- **JWT_SECRET:** private random signing key, at least 32 bytes. The existing local file received a generated key during JWT integration. Production requires a configured key; development can use a temporary key, invalidating sessions on restart.
- **NODE_ENV:** development or production. Controls secure cookies, HTTPS requirements, demo restrictions, and validation.
- **APP_ORIGIN:** exact website origin, without path/trailing slash. Vite development sets the running process's actual URL automatically. Direct Express normally needs http://127.0.0.1:4000; production requires the actual public HTTPS origin.
- **PORT:** API port, default 4000.
- **HOST:** loopback by default in development and 0.0.0.0 in production; Compose explicitly sets 0.0.0.0 inside the container.
- **TRUST_PROXY:** optional trusted proxy addresses/subnets separated by commas; configure for the actual deployment so client IP handling is correct.
- **DEMO_MODE, DEMO_PASSWORD, SEED_DEMO:** optional development controls still present in code. Not required for ordinary accounts. Production rejects enabled demo/seed flags.
- **ADMIN_EMAIL, ADMIN_PASSWORD:** temporary inputs to create the first administrator; not needed for regular account login afterward.

There are no SMTP requirements. Browser code must never receive database credentials, JWT_SECRET, or the Admin bootstrap password.

## 7. Running locally

```powershell
cd C:\CLAUDE_env\Nemo_PBL
.\Start.ps1
```

Open the Vite URL printed in the terminal, usually http://127.0.0.1:5173. Stop with Ctrl+C before another start. VS Code Live Server cannot run the Express API or database authentication.

The launcher runs commands through the project's uv environment. Other tasks:

```powershell
.\Start.ps1 -Task build
.\Start.ps1 -Task test
.\Start.ps1 -Task start
.\Start.ps1 -Task format:check
```

Build checks TypeScript and writes `dist/`. Start serves Express and the built frontend, without Vite. Set APP_ORIGIN to the address used in the browser. Formatting checks are separate from functional tests.

To create the first Admin, set your own ADMIN_EMAIL/ADMIN_PASSWORD and MONGODB_URI locally, then run:

```powershell
.\Start.ps1 -Task admin
```

The command refuses if an Admin already exists. Remove ADMIN_PASSWORD from `.env` afterward. Public signup always creates Employees; existing Admins manage subsequent elevated accounts.

## 8. Docker and eventual deployment

The Dockerfile builds frontend assets, installs production dependencies, and assembles a Node 22 runtime running as a non-root user. It contains server code and dist, exposes port 4000 by default, and checks `/api/health`.

Compose runs one service named nemo with a read-only filesystem, temporary `/tmp`, dropped Linux capabilities, and a published port restricted to host loopback. It does not create an Atlas database or start a MongoDB container. The image requires a configured MongoDB URI because its dependencies exclude the development fallback package.

With Docker Desktop running, execute from the project folder:

```powershell
uv --no-cache run --no-project --offline --python .venv/Scripts/python.exe docker compose up --build -d
uv --no-cache run --no-project --offline --python .venv/Scripts/python.exe docker compose ps
uv --no-cache run --no-project --offline --python .venv/Scripts/python.exe docker compose logs nemo
uv --no-cache run --no-project --offline --python .venv/Scripts/python.exe docker compose down
```

Compose injects `.env` values. dotenv does not override already-supplied environment values. Recreate the container after editing `.env`; a plain restart does not reload Compose's injected values.

A future Render deployment can serve the frontend/API together using the Dockerfile or a Node build/start setup. Supply production secrets, public HTTPS APP_ORIGIN, disabled demo flags, and Atlas network access. Configure trusted proxies for the actual hosting environment. A Dockerfile alone does not establish a deployment; platform details must be checked at deployment time.

## 9. Tests and verified scope

During JWT integration, the latest run passed **36 tests**, **0 failures**, in approximately **40.1 seconds**. TypeScript and the production build passed. This is the recorded implementation result, not a new run performed while writing documentation.

- `auth.test.mjs`: 8 tests; demo login, signup, duplicate/invalid input, role injection, password hashing, JWT verification, logout replay, key rotation, configuration.
- `frontend.test.mjs`: 5 tests; API helpers, expiry handling, display formatting, CSV.
- `services.test.mjs`: 14 tests; health, sessions, passwords, throttling, users, policy, uploads, claims, reimbursement, audit, bootstrap, error handling.
- `workflow.test.mjs`: 9 tests; permissions, privacy, policy, review order, stale edits, concurrent operations, snapshots, self-approval prevention.

Tests use temporary MongoDB databases and Supertest; they do not populate or reset the user's Atlas database. They are not full browser end-to-end tests or deployment load tests.

The build reported a large JavaScript chunk warning. The runtime dependency audit during JWT integration reported five advisories (three high, two moderate) outside jsonwebtoken. These remain unresolved by that integration; recheck and address applicable advisories before public deployment. This recorded count is not a permanent statement about future dependency versions.

## 10. Current limits and future work

Implemented protections include revocable JWT sessions, backend permissions, validation, upload size/signature checks, origin/header checks, and atomic claim transitions. Remaining areas include:

- Email ownership verification, forgotten-password recovery, MFA, and provider sign-in.
- Automatic session renewal; current login expires after 15 minutes.
- Tenant isolation if unrelated companies use the same application.
- External payments and a fuller accounting lifecycle.
- Receipt malware scanning, content-based duplicate detection, unused-upload cleanup.
- Pagination for large claim/user lists and efficient large-dashboard loading.
- Shared rate-limit storage when scaling to multiple replicas.
- Deployment monitoring, backups, recovery testing, dependency maintenance, load testing.

Reusing a submitted receipt ID is prevented, but re-uploading identical file bytes creates another record. File signature checks do not prove that a receipt is safe or authentic.

A capacity test must simulate login, claim reads, draft edits, submission, and uploads on the intended hosting plan. Measure latency, failures, CPU/memory, database operations/connections, and storage growth. Registered accounts and simultaneously active users are different quantities. Nemo currently has no tested deployment user-capacity guarantee.
