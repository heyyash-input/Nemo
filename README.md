# Nemo — Enterprise Expense Management

BCC75 college PBL project. A React frontend and Express/MongoDB backend covering employee claims, manager approval, finance verification, and internal reimbursement accounting.

## Detailed project guides

- [API flow images by role](docs/api-flows/README.md): Employee, Manager, Finance, and Admin diagrams in PNG and SVG.
- [Application flow](flow.md): signup, JWT sessions, roles, receipts, approval, and reimbursement walkthrough.
- [Technical guide](tech.md): stack, source map, database records, API routes, environment settings, Docker, and testing.

## Current college demo setup

The local `.env` uses `DEMO_MODE=true` and `DEMO_PASSWORD=NemoDemo@123`. Sign in with a demo account or the role shortcuts. Existing MongoDB users and claims are preserved. Missing demo users are created automatically, including when a MongoDB URI is configured.

Run `.\Start.ps1`, then select a role on the login page or use these accounts with password **NemoDemo@123**:

- Employee: `employee@nemo.demo`
- Manager: `manager@nemo.demo`
- Finance: `finance@nemo.demo`
- Admin: `admin@nemo.demo`

The demo employee reports to the demo manager. Admin can create additional accounts in Users. Existing demo users are preserved on restart; changing DEMO_PASSWORD does not reset their passwords. Demo shortcuts and accounts are blocked in production.

## Run on Windows

The project lives at `C:\CLAUDE_env\Nemo_PBL`. Commands run through the local uv environment; nothing is installed into system Python.

```powershell
cd C:\CLAUDE_env\Nemo_PBL
.\Start.ps1
```

Open the localhost URL printed by Vite, usually **http://127.0.0.1:5173**. If that port is occupied, the development launcher selects the next available port and configures the API origin automatically. Node.js 20.19+ and uv are prerequisites. The startup script creates `.venv` and installs npm packages if needed.

Configure `MONGODB_URI` for normal use. An explicit `DEMO_MODE=true` with no URI enables a local demonstration database using `mongodb-memory-server`, with persistent WiredTiger storage at `.data/mongo`. The first run downloads a MongoDB binary; later starts reuse `.data/mongodb-binaries`. Demo mode is prohibited in production. Stop with Ctrl+C before starting a second instance.

The local demo provides **Employee, Manager, Finance, and Administrator** buttons on the sign-in page. These shortcuts are enabled when DEMO_MODE=true in development, including with a configured MongoDB database. They must never be exposed as a shared enterprise login. Sample receipts are explicitly labelled demo documents. Password-based sign-in also works; generated demo credentials are saved locally in `.data/demo-credentials.txt` and excluded from Git.

## Demonstrate the complete workflow

1. Sign in as **Employee**. Choose **New expense**, enter a title and purpose, add expense lines, and attach PDF/JPEG/PNG receipts (up to 5 MB each).
2. Save a draft, or submit. Submission enforces the current category limits, receipt requirement, expense dates, submission window, and claim limit.
3. Sign out and enter **Manager**. Open **Approvals**, inspect the claim and receipts, then approve or reject with a reason.
4. Sign in as **Finance**. Verify a manager-approved claim. Open **Reimbursements**, select a ready claim, and record the payment date, method, and reference.
5. Inspect the completed claim's accounting journal and activity history. The employee can now see the reimbursed status.
6. Sign in as **Administrator** to add accounts, assign reporting managers, edit policy limits/accounts, and inspect the audit trail.

The initial manager demo account has no reporting manager. An admin can create another manager and assign them if that account needs to submit its own expenses. Nobody can approve, verify, or reimburse their own claim.

## Implemented features

- Responsive React/TypeScript dashboard, Material UI forms and dialogs, expense search and status filters.
- Password hashing, 15-minute signed JWTs in HttpOnly cookies with server-side revocation, logout, password changes, login rate limits, and request-origin/header checks.
- Employee, Manager, Finance, and Admin permissions enforced by the API, including receipt access.
- Multi-line claims, persistent receipt uploads, drafts, rejection reasons, correction, and resubmission.
- Company policy checks at submission; saved policy snapshots preserve accounting mappings for existing claims.
- Manager review followed by finance verification and an internal reimbursement record.
- Balanced debit/credit journal, CSV claim exports and journal exports, claim history, and admin audit events.
- Admin user creation, activation/deactivation, roles, departments, and manager assignment.
- Atomic claim transitions, optimistic version checks, and a unique submitted-receipt index.

## Workflow and accounting

`Draft → Submitted → Manager approved → Finance verified → Reimbursed`

Managers and finance staff can reject at their respective review stage. The owner can edit a rejected claim, returning it to draft, then submit again. All earlier events remain in the claim history. Submitted claim data cannot be edited, and reimbursed claims are immutable through the API.

This version uses **INR only** and stores all amounts as integer paise. When Finance records reimbursement, category expense accounts are debited and the Bank or Cash account is credited. This is a simplified reimbursement-time journal; it does not implement accrual postings at approval, tax calculations, a complete general ledger, reversals, or external money transfers.

The reimbursement and journal are embedded in the same claim and saved in one conditional MongoDB update. Duplicate or concurrent settlement attempts cannot create two reimbursements. Reusing the same uploaded receipt ID in multiple submitted claims is blocked, including concurrent submissions. Uploading the same physical receipt again creates a new ID; OCR and content-based fraud detection are outside this version.

Receipts are stored in a separate MongoDB collection and downloaded through permission-checked API routes. File signatures are checked, and downloads are attachments. Receipt virus scanning and automatic cleanup of unused uploads are not included.

## Use your own MongoDB

Create or edit the single root `.env` file, then set `MONGODB_URI` to your MongoDB Community or Atlas connection string. Keep passwords in `.env` and out of Git. Use `APP_ORIGIN=http://127.0.0.1:4000` for direct API/Docker access. The Vite development launcher automatically uses its own URL for the API origin check.

Configured databases receive the four missing demo accounts when DEMO_MODE=true, without sample claims. For a blank personal demo database, explicitly set `SEED_DEMO=true` and `DEMO_PASSWORD` before startup. This adds samples only when no users exist. Role shortcut buttons require DEMO_MODE=true; otherwise sign in using email and password.

For a clean database without sample records, set `MONGODB_URI`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` locally, then run:

```powershell
.\Start.ps1 -Task admin
```

The bootstrap command creates the first administrator only and refuses if an admin already exists. Choose your own `ADMIN_EMAIL` and a new `ADMIN_PASSWORD` of at least 10 characters (maximum 72 UTF-8 bytes). This password is for Nemo login. The command hashes it before saving the user to MongoDB. Remove `ADMIN_PASSWORD` from `.env` afterward. Sign in as admin to assign roles and reporting managers in Users.

## Account access

Use **Create an account** to register with your full name, email, department, and a password of at least 10 characters (maximum 72 UTF-8 bytes). Signup always creates an employee; the administrator assigns a reporting manager in Users before claims can be submitted. Roles cannot be selected during signup. Email ownership is not verified and SMTP/OTP remains removed.

Sample signup inputs (not pre-created accounts): Asha Rao, `asha.employee@example.com`, Engineering, `NemoSample!2026A`; Ravi Shah, `ravi.employee@example.com`, Sales, `NemoSample!2026B`. Use unique private passwords for real accounts. To test manager/finance access, have an admin change the account role, then sign in again.

Signup (`POST /api/auth/signup`) and login (`POST /api/auth/login`) return the public profile and set the `session` cookie. It contains an HS256 JWT signed with `JWT_SECRET`: user ID (`sub`), unique token ID (`jti`), issuer, audience, issue time, and expiry. JWT contents are readable, not encrypted; passwords and expense data are never placed in the token. The browser sends this HttpOnly, SameSite=Strict cookie automatically to `/api`. Production also requires Secure/HTTPS. Nothing is stored in localStorage.

Protected routes verify the signature, algorithm, issuer, audience, and expiry, then check the session hash and active user in MongoDB. Permissions use the current database role. Logout deletes the session; password and account changes revoke that user's sessions. A copied token stops working after revocation. Tokens expire after 15 minutes, including during active use; sign in again when prompted. There is no refresh token. Existing opaque cookies require a fresh login after this upgrade.

Set `JWT_SECRET` to a private random value of at least 32 bytes. The local `.env` has a generated key; configure it as a Render environment secret when deploying. Never commit or share it. Development without a key uses a temporary key and invalidates logins on restart; production refuses to start without a configured key. Rotating the key invalidates existing JWTs.

## One environment file for local development and Docker

Both the local Node server and Docker Compose read the root `.env`. It is ignored by Git and excluded from the Docker build context. There are no separate Docker or example environment files. For a fresh checkout, create `.env` with:

```env
MONGODB_URI=
PORT=4000
APP_ORIGIN=http://127.0.0.1:4000
NODE_ENV=development
DEMO_MODE=true
DEMO_PASSWORD=NemoDemo@123
SEED_DEMO=false
TRUST_PROXY=
```

Paste your MongoDB URI into `MONGODB_URI`. An Atlas URI can be used by both local Node and Docker when its network access permits them. For a Windows-hosted MongoDB, local Node normally uses `127.0.0.1` whereas Docker Desktop uses `host.docker.internal`; update that hostname in this same file when switching runtimes. Docker requires a configured database because the runtime image does not include the automatic development MongoDB package.

Start locally using `.\Start.ps1`. To start Docker, open Docker Desktop and run `docker compose up --build -d` through your uv environment. Open `http://127.0.0.1:4000` (or your configured PORT). Compose binds the published port to your computer's loopback address. Its only environment override is `HOST=0.0.0.0`, required to reach the server inside the container. Application mode, database, port, and origin come from `.env`.

Use `docker compose ps` to see the container and `docker compose logs nemo` for startup details. Stop it with `docker compose down`. Run `docker compose up -d --force-recreate` after editing `.env`; a plain container restart does not reload Compose environment values. Keep SEED_DEMO=false for the read-only container; missing demo identities are created in MongoDB automatically when DEMO_MODE=true.

For public deployment, change the same `.env` to `NODE_ENV=production`, `DEMO_MODE=false`, `SEED_DEMO=false`, an authenticated reachable MongoDB URI, and the actual HTTPS APP_ORIGIN. Configure an HTTPS reverse proxy and trusted proxy addresses. The current request rate limits support a single application instance. Backups, monitoring, and deployment verification still require setup.

## Build and checks

```powershell
.\Start.ps1 -Task build
.\Start.ps1 -Task test
```

Build runs TypeScript checking and Vite bundling. Tests use a separate temporary MongoDB database and cover access restrictions, receipt permissions, policy rejection, valid workflow transitions, revision conflicts, concurrent settlement, policy snapshots, and self-approval prevention. Tests do not reset the application's development database.

After building, `Start.ps1 -Task start` serves the API and `dist` through Express on **http://127.0.0.1:4000**. Set `APP_ORIGIN=http://127.0.0.1:4000` when using this address directly. Without that change, mutation requests from port 4000 will be rejected by the origin check.

For eventual production deployment, use `NODE_ENV=production`, a configured `MONGODB_URI`, an HTTPS reverse proxy to the loopback Express service, and `APP_ORIGIN` equal to the public HTTPS origin. Production uses secure cookies, requires a database connection, and disables all demo sign-in routes. Deployment, database backups, account recovery, receipt malware scanning, and enterprise SSO require separate setup before real employee use.

## Source layout

- `src/` — React frontend, route screens, typed API client, styles.
- `server/app.mjs` — API, authentication, authorization, claim transitions, uploads.
- `server/models.mjs` — MongoDB schemas and indexes.
- `server/domain.mjs` — request validation, policy rules, accounting entries.
- `server/database.mjs` — configured/local MongoDB lifecycle.
- `server/seed.mjs` — local demonstration records and sample receipts.
- `server/tests/workflow.test.mjs` — isolated API integration checks.
- `Start.ps1` — uv-based Windows launcher.

The frontend uses the recommended React + TypeScript + Material UI option from our discussion. The backend follows the selected Node.js + Express + MongoDB synopsis stack. Dependencies are pinned by `package-lock.json`.

Framework references: [Express](https://expressjs.com/en/starter/installing/), [Vite](https://vite.dev/guide/), [Material UI](https://mui.com/material-ui/getting-started/installation/), [Mongoose](https://mongoosejs.com/docs/guide.html).

## Reading and maintaining the code

Start with `src/main.tsx`, which mounts the React application, then `src/App.tsx`, which loads the signed-in user and chooses the screen. `src/AuthPage.tsx` handles login and demo role shortcuts. `src/expenses.tsx` contains the expense editor and claim details, while `src/pages.tsx` contains summaries, policies, reimbursements, and account settings. Reusable UI elements are in `src/components.tsx`; browser API calls and display formatting are in `src/api.ts`.

On the backend, `server/dev.mjs` starts development, `server/index.mjs` connects the database and starts HTTP, and `server/app.mjs` defines the API routes. `server/models.mjs` defines stored records. `server/domain.mjs` contains expense validation and accounting rules. `server/seed.mjs` creates demo data. Accounts are managed by administrators; the login screen also offers development demo shortcuts.

Each function has a purpose comment, including request handlers and small UI callbacks. Amounts ending in `Minor` are integer paise: 100 paise equals one rupee. MongoDB `__v` is a version used to reject stale updates. Comments around session handling, receipt permissions, and claim transitions explain those checks.

Format source files after editing with `.\Start.ps1 -Task format`. Check formatting without changing files with `.\Start.ps1 -Task format:check`. These commands use the pinned Prettier development dependency. Run `.\Start.ps1 -Task build` for TypeScript checking and bundling, and `.\Start.ps1 -Task test` for isolated API workflow checks.
