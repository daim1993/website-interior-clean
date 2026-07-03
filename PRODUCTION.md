# Eleve Production Runbook

This project is a custom website plus web app: public brand pages, gallery, materials library, room builder, CMS, accounts, client portal, analytics, content API, billing hooks, backups, and static hosting.

## Required Environment

Set these before public launch:

```env
NODE_ENV=production
APP_URL=https://your-domain.example
ADMIN_PASSWORD=use-a-long-random-password
SECRET=use-a-long-random-signing-secret
DATABASE_URL=postgres-connection-string
ORIGINS=https://your-domain.example
SUPPORT_EMAIL=support@your-domain.example
```

Use `DATABASE_URL` for real deployments. Local JSON storage is useful for development, but a hosted disk can disappear on free or ephemeral platforms.

## Payments

Stripe checkout is wired but needs real credentials:

```env
STRIPE_SECRET=sk_live_...
STRIPE_PRICE_PRO=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Stripe Dashboard setup:

1. Create a recurring Pro price and copy its price id into `STRIPE_PRICE_PRO`.
2. Add a webhook endpoint: `https://your-domain.example/api/billing/webhook`.
3. Subscribe the webhook to:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

If billing is not configured, `/api/billing/checkout` returns a setup error and does not fake a payment.

## Backups

The server creates compressed snapshots containing:

- Main content and account DB
- Builder projects
- Client portal documents

Defaults:

```env
BACKUP_DIR=server/backups
BACKUP_KEEP=30
BACKUP_INTERVAL_MS=21600000
```

Admin-only endpoints:

- `GET /api/admin/backups`
- `POST /api/admin/backups/run`

For production, keep off-platform backups too. If using Postgres, enable provider-level automated backups or point-in-time recovery.

## Support

Set:

```env
SUPPORT_EMAIL=support@your-domain.example
```

The support metadata is exposed at `/api/support` for operational checks and UI integrations.

## QA Before Launch

Run from `server/`:

```bash
npm install
npm audit --audit-level=moderate
npm test
node --check server.js
```

Then smoke test:

- `/healthz` returns `200`
- `/index.html`, `/gallery.html`, `/materials.html`, `/portal.html`, `/cms.html` load
- `/server/db.json`, `/server/server.js`, and `/server/backups/...` return `404`
- Checkout redirects to Stripe only when Stripe variables are configured
- A Stripe webhook event upgrades the matching account to Pro

## Rollback

1. Revert the deployment to the previous known-good build.
2. Restore Postgres from provider backup if data changed incorrectly.
3. For local JSON mode, restore the latest `snapshot-*.json.gz` from `BACKUP_DIR`.
4. Rotate `SECRET` and `ADMIN_PASSWORD` if credentials were exposed.

