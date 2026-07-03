# Eleve Interior Website

Custom luxury interior-design website and web app with public pages, gallery, materials library, room builder, CMS/admin tools, accounts, client portal, analytics, billing hooks, backups, and production runbook.

## Run Locally

```bash
cd server
npm install
npm start
```

Open `http://127.0.0.1:4000/`.

## Production Setup

Copy `server/.env.example` into your deployment environment and set real values for:

- `SECRET`
- `ADMIN_PASSWORD`
- `APP_URL`
- `ORIGINS`
- `DATABASE_URL`
- `STRIPE_SECRET`
- `STRIPE_PRICE_PRO`
- `STRIPE_WEBHOOK_SECRET`
- `SUPPORT_EMAIL`

See `PRODUCTION.md` for launch, payment, backup, QA, and rollback details.

## Verification

```bash
cd server
npm audit --audit-level=moderate
npm test
node --check server.js
```
