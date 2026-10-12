# Ethical Commerce

**Open-source-first, transparency-led commerce infrastructure.** Built for a free-to-start storefront experience, responsible dropshipping and evidence-based product passports.

## Product scope

- Merchant accounts, separate stores and branding, public storefronts and catalogue.
- Supplier registry, product editing, stock and pricing, traceability records and evidence submissions.
- Digital product passports with claims **explicitly labelled** as declared, evidence checked or independently verified.
- Human-rights, environmental, animal-welfare, safety and commercial-transparency claims; no composite greenwashing score.
- Exportable channel catalogues, manually approved listing workflow and extensible adapters.
- Consumer complaints with authorised seller review. **Confidential worker reporting is not yet available**; the seller-facing form blocks worker disclosures.
- Accessible, mobile-first storefront and merchant console.
- Audit trail, tenant isolation, D1-backed throttling for high-risk endpoints, restrictive browser headers and Cloudflare D1 persistence.

## Run locally

Requirements: Node 20+, npm, a Cloudflare account for deployments.

1. Run `npm install`.
2. Use the configured `ethicalcommerce` D1 binding (or create a separate local/test database if required); the production database UUID is already configured in `wrangler.toml`.
3. Run `npm run db:local` then `npm run dev`.
4. Visit the local address printed by Wrangler. Register, create a store and add products.
5. Run `npm run check` for type checks and tests. After local migration, use `npm run smoke` for the local lifecycle integration test.

For production: apply `npm run db:remote` **after reviewing the migration** to initialise the remote D1 database, then run `npm run deploy`. The GitHub-connected Cloudflare build's default `npx wrangler deploy` command does not automatically apply migrations. See `docs/CLOUDFLARE_D1_SETUP.md` before enabling public registrations.

## Important launch limitations

**This is an implementable foundation, not a certified or production-approved marketplace.** It deliberately does not charge customers or pretend to send real orders to suppliers. Stripe Connect/merchant-of-record decisions, payment flows, marketplace OAuth/API approvals, supplier contracts, independent verification, upload security, anti-spam, legal policies and a live operational review process are mandatory before public commercial rollout. Channel publishing initially exports a genuine CSV; no channel is falsely labelled connected.

The public deployment is a **pre-launch preview**, not a verified marketplace. Registration currently has no email ownership verification, and abuse counters do not replace Cloudflare WAF, Turnstile, external security review or platform moderation. The site is marked noindex until a compliant public launch.

An ethical claim is not verified just because a merchant submits it. Platform administrators may independently review submitted evidence, but review by itself is not independent certification. Public records display their actual evidence status and gaps.

## Architecture

Cloudflare Workers (TypeScript), D1 SQLite, Workers Static Assets (HTML/CSS/JS), Web Crypto and an HTTP-only database-backed session cookie. No required subscription framework. Usage above Cloudflare free allowances is billed according to the hosting provider's terms.

See `docs/ARCHITECTURE.md`, `docs/ETHICS.md` and `docs/GO-LIVE.md`.

## Security

Do not commit real secrets. Set account administration and production settings through deployment configuration. Never publish worker personal data, private factory details or private supplier price breakdowns without permission.

## License

MIT, subject to supplier content and third-party API terms.
