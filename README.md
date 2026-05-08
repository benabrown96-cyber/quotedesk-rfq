# QuoteDesk — TEG RFQ System

Internal RFQ (Request for Quotation) management platform for TEG (The Experts Group).
Supports Tropicoir Lanka, Premier Tech Lanka, Euro Substrates, and Growrite Substrate.

## Features

- Multi-company, multi-cluster RFQ workflow
- Role-based access: Senior Management, Commercial Manager, Commercial Staff, Factory User, Vendor
- Product Manufacturing, Polybags, Cardboard, Logistics, Packaging, Other Suppliers categories
- Vendor portal with tokenized external access
- Award recommendation workflow
- Document management (PO + Pricing Quotation)
- Audit trail and notifications
- Quote comparison table

## Tech Stack

- **Frontend:** React 18, TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Express.js (Node 20)
- **Database:** SQLite (demo) → PostgreSQL (production)
- **ORM:** Drizzle ORM

---

## Deploy to Railway

### Step 1 — Fork or upload this repo to GitHub

### Step 2 — Create a Railway project

1. Go to [railway.com](https://railway.com)
2. Click **New Project → Deploy from GitHub repo**
3. Select this repository
4. Railway detects the `Dockerfile` automatically

### Step 3 — Add a Volume (for SQLite persistence)

1. In your Railway service, go to **Settings → Volumes**
2. Add a volume mounted at `/app/data`
3. This keeps your database data between deploys

### Step 4 — Set environment variables

In Railway → **Variables**, add:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `PORT` | `5000` (Railway sets this automatically) |
| `DATABASE_PATH` | `/app/data/data.db` |

### Step 5 — Generate your domain

In Railway → **Settings → Networking**, click **Generate Domain**.
Your live URL will appear — share it with your team.

---

## Local Development

```bash
npm install
npm run dev
```

App runs at `http://localhost:5000`

---

## Production Roadmap

| Item | Status |
|------|--------|
| SQLite (demo) | ✅ Active |
| PostgreSQL migration | 📋 See PRODUCTION_READINESS.md |
| Microsoft Entra ID login | 📋 See AUTHENTICATION_SETUP.md |
| Microsoft Graph email | 📋 See PRODUCTION_READINESS.md |
| Azure Blob Storage | 📋 See PRODUCTION_READINESS.md |

---

## Environment Variables Reference

See `.env.example` for the full list including production Microsoft/Azure variables.
