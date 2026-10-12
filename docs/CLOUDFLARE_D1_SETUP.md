# Resolve Cloudflare D1 binding error 10021

A Cloudflare Worker deploy will fail with `binding DB of type d1 must have a valid database_id specified [code: 10021]` until `wrangler.toml` references a real D1 database UUID in the **same Cloudflare account** as the Worker.

**Do not replace `database_id` with the account ID; they are different identifiers. Do not remove the D1 binding to make the site appear deployed: the commerce API requires this database.**

## Option A: Cloudflare dashboard + GitHub (no terminal required to identify the ID)

1. Open [Cloudflare dashboard](https://dash.cloudflare.com/) and select the account that owns the `ethical-commerce` Worker.
2. Go to **Storage & databases → D1 SQL database** (menu wording may vary).
3. If a database named `ethical-commerce` exists, open it and copy its **Database ID**. Otherwise choose **Create database**, name it `ethical-commerce`, and copy the newly created database ID.
4. In GitHub, open `wrangler.toml` and replace `REPLACE_WITH_D1_DATABASE_ID` with the copied UUID. Preserve `binding = "DB"` and `database_name = "ethical-commerce"`.
5. Commit to `main` to trigger the connected Cloudflare deployment.
6. **Before opening registrations**, initialise the production tables using the remote database migration (see below). A deployed Worker with an empty D1 database can still return 500 responses.

## Option B: Wrangler CLI (authenticated to the correct Cloudflare account)

If the DB already exists:

```sh
npx wrangler d1 list --json
```

If not, create it:

```sh
npx wrangler d1 create ethical-commerce
```

Use the returned database UUID in `wrangler.toml`, then run:

```sh
npm install
npx wrangler d1 migrations apply ethical-commerce --remote
npx wrangler deploy
```

Migration `0001_initial.sql` establishes the actual tables required by the API.

## Cloudflare Workers Builds and migrations

The default Cloudflare build token is generally for Worker deployment and does **not necessarily** include permission to create or edit D1 databases. If `d1 migrations apply --remote` returns a permission error, run it once locally with a Cloudflare-authenticated account that has D1 edit permissions. Do not place a personal/global API key in the repo.

Once it has D1 permissions, you may configure the Workers Builds **Deploy command** as:

```sh
npx wrangler d1 migrations apply ethical-commerce --remote && npx wrangler deploy
```

Only enable this if the token has the necessary permissions and backups / migration review are handled.

## Verification after a successful deployment

1. `GET https://YOUR-WORKER.workers.dev/api/health` should return `{"ok":true,...}` (connectivity only).
2. `GET /api/public/products` must return 200 with `{"products":[]}` on an empty but migrated database.
3. Register a **test-only** merchant account on a staging/non-public deployment. Test creation of a store, supplier, product, trace event and evidence claim.
4. Check Worker logs for failures, verify data appears in D1, and confirm stores cannot access each other's records.
5. Do not enable production checkout, marketplace posting or promises of independent verification: these remain unimplemented and require dedicated launch approval.

## Quick diagnostic

| Cloudflare response | Meaning |
| --- | --- |
| `10021: invalid database_id` | Bad or placeholder UUID; deployment blocked |
| `authentication/permissions` | Wrong account or token lacks D1 access |
| `no such table: users/products` | Deployed with D1 but production migration not applied |
| `/api/health` succeeds but products fail | Health endpoint does not test the database: apply migrations and inspect logs |

Cloudflare reference: https://developers.cloudflare.com/d1/get-started/
