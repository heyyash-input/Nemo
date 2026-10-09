# Nemo — Enterprise Expense Management

BCC75 college PBL project. A React frontend and Express/MongoDB backend covering employee claims, manager approval, finance verification, and internal reimbursement accounting.

## Run on Windows

The project lives at `C:\CLAUDE_env\Expense_PBL`. Commands run through the local uv environment; nothing is installed into system Python.

```powershell
cd C:\CLAUDE_env\Expense_PBL
.\Start.ps1
```

Open the localhost URL printed by Vite, usually **http://127.0.0.1:5173**. If that port is occupied, the development launcher selects the next available port and configures the API origin automatically. Node.js 20.19+ and uv are prerequisites. The startup script creates `.venv` and installs npm packages if needed.

Configure `MONGODB_URI` for normal use. An explicit `DEMO_MODE=true` with no URI enables a local demonstration database using `mongodb-memory-server`, with persistent WiredTiger storage at `.data/mongo`. The first run downloads a MongoDB binary; later starts reuse `.data/mongodb-binaries`. Demo mode is prohibited in production. Stop with Ctrl+C before starting a second instance.

The local demo provides **Employee, Manager, Finance, and Administrator** buttons on the sign-in page. These shortcuts are enabled only for the automatic local development database. They must never be exposed as a shared enterprise login. Sample receipts are explicitly labelled demo documents. Password-based sign-in also works; generated demo credentials are saved locally in `.data/demo-credentials.txt` and excluded from Git.

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
- Password hashing, opaque server-side sessions in HttpOnly cookies, logout, password changes, login rate limits, and request-origin/header checks.
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

Copy `.env.example` to `.env`, then set `MONGODB_URI` to your MongoDB Community or Atlas connection string. Keep passwords in `.env` and out of Git. Set `APP_ORIGIN=http://127.0.0.1:5173` for local Vite development.

External databases are **not** seeded by default. For a blank personal demo database, explicitly set `SEED_DEMO=true` and `DEMO_PASSWORD` before startup. This adds samples only when no users exist. Role shortcut buttons remain disabled for external databases; sign in using email and password.

For a clean database without sample records, set `MONGODB_URI`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` locally, then run:

```powershell
.\Start.ps1 -Task admin
```

The bootstrap command creates the first administrator only and refuses if an admin already exists. Choose your own `ADMIN_EMAIL` and a new `ADMIN_PASSWORD` of at least 10 characters (maximum 72 UTF-8 bytes). This password is for Nemo login. The command hashes it before saving the user to MongoDB. Remove `ADMIN_PASSWORD` from `.env` afterward. Sign in as admin to assign roles and reporting managers in Users.

## Email OTP signup

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` in `.env`. Port 587 uses STARTTLS with `SMTP_SECURE=false`; port 465 uses `SMTP_SECURE=true`. Set `OTP_SECRET` to a random secret of at least 32 characters. Keep the existing generated secret if already configured.

For Gmail, enable Google 2-Step Verification and create an app password for Nemo. Use `smtp.gmail.com`, port `587`, your full Gmail address as `SMTP_USER`, and the app password as `SMTP_PASSWORD`. Set `SMTP_FROM="Nemo <your-address@gmail.com>"`. See [Google app password instructions](https://support.google.com/mail/answer/185833) and [SMTP settings](https://support.google.com/mail/answer/7104828). Some managed accounts restrict app passwords.

```powershell
.\Start.ps1 -Task check-mail
.\Start.ps1
```

The mail check verifies SMTP connection/authentication without sending email. Restart the app after editing environment variables. Signup creates a pending record with a password hash and protected OTP; successful email verification creates an Employee account and signs it in. Codes expire after 10 minutes, allow five attempts, and can be resent after 60 seconds. Admin assigns elevated roles and a reporting manager. Employees without a manager can save drafts but cannot submit claims. Login automatically uses the stored role; public role selection would not grant permissions.

Optional `SIGNUP_ALLOWED_DOMAINS=your-company.com` limits registration domains. Leaving it empty allows any email that completes verification. Demo accounts are blocked in production.

## Docker deployment

1. Start Docker Desktop with the Linux container engine.
2. Copy `docker.env.example` to `.env.docker` and fill MongoDB, SMTP, `OTP_SECRET`, and the public HTTPS `APP_ORIGIN`. Do not commit this file.
3. Run `docker compose up --build -d` through your uv environment. The image contains the built frontend and API, runs as a non-root user, and excludes local secrets and database files.
4. Configure an HTTPS reverse proxy on the host to forward to `127.0.0.1:4000`. Compose binds only to this loopback address. Configure `TRUST_PROXY` only for your proxy's known IPs/subnets. Secure production cookies require HTTPS.
5. Use `docker compose logs nemo` for startup diagnostics and `docker compose down` to stop.

The container connects to your configured MongoDB; it does not bundle a database. For Docker Desktop local evaluation, Windows MongoDB uses `host.docker.internal`, not `127.0.0.1` inside the container. For deployment, configure an authenticated reachable database and backups. Provision the first administrator using the admin task against that same database before handing over the application.

The current rate limits are per process: deploy one application replica until a shared rate-limit store is added. Account recovery, malware scanning, backups, monitoring, and organization-specific access policies still need operational setup before real employee use. SMTP delivery and the Docker image must be verified in the target environment.

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
