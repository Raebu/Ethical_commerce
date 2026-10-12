# End-to-end order & supplier communications commissioning

## Current status

This change implements **transaction lifecycle components**, not an authorisation to trade. Checkout and outbound messaging both remain disabled until the platform operator configures and approves them. Supplier order emails require an additional *per supplier* and *per purchase order* merchant authorisation. The default software release makes no payments, places no external orders and sends no email.

## Transaction journey

1. Seller verifies email through the transactional email provider, completes public legal and consumer policies, and Stripe Connect verifies the merchant. Only the operator can release live transactions.
2. Customer selects a published, in-stock product, consents to the published policies and enters hosted Stripe Checkout. Goods are stock-reserved in an atomic D1 database batch; original supplier assignments are snapshotted.
3. Signed Stripe Connect webhooks confirm payment, and the system creates a fulfilment record. Stripe is the payment authority: returning from Checkout does **not** imply payment success.
4. **Notifications** are added to a D1 outbox with unique event keys: buyer confirmation and verified store-owner alert. Once enabled, the scheduled worker delivers through Resend with a provider idempotency key, a five-minute lease and bounded retries.
5. The seller views the paid order and retrieves any delivery address directly from Stripe on demand. The address is **not** sent to suppliers automatically or copied into the outbox.
6. The seller prepares one purchase order draft per recorded supplier. The seller-owner must authorise each supplier's business ordering email. The seller explicitly chooses **Email supplier purchase order** for each draft. The message contains item names, quantities and SKUs; it never includes customer contact or address details.
7. The seller tracks supplier acceptance/dispatch manually. Once carrier and tracking reference are entered, the buyer receives a delivery update if transactional email is enabled.
8. Consumers can request a return, cancellation, refund, fault remedy or complaint review via their private order link. Verified seller owners are alerted. A confirmed Stripe refund event can generate a buyer refund notification.

## Secrets and explicit flags

Set using **Cloudflare Worker secrets**, not source code:

- `STRIPE_SECRET_KEY` — use a Stripe test/sandbox key for commissioning, never paste in chat or GitHub.
- `STRIPE_CONNECT_WEBHOOK_SECRET` — signing secret for verified Connect payment events.
- `RESEND_API_KEY` — Resend transactional email API token.
- `EMAIL_FROM` — sender identity on a verified sending domain.
- `ENCRYPTION_MASTER_KEY` — base64 32-byte AES-GCM key if using marketplace store connections.

Keep these **false or unset** during commissioning:

- `SALES_ENABLED`
- `STRIPE_TAX_ENABLED`
- `NOTIFICATIONS_ENABLED`
- `COMMERCIAL_LAUNCH_APPROVED`
- `PUBLISHING_ENABLED`

Enable them only after verifying provider setup, tax and consumer law requirements, a legitimate and supportable seller contact/returns process, signed production webhooks, genuine product suppliers, email delivery and operational response. At checkout and store-unpause, the Worker checks the relevant flags **and** all Stripe, tax and email integration secrets. Readiness to accept payment is not equivalent to legal clearance.

## Resend delivery

The scheduled worker runs at 15-minute intervals and processes a capped number of messages. It uses the official Resend Idempotency-Key header to reduce duplicate emails. Retries are limited, failed messages remain visible in the database for support, and only customer service or agreed supplier procurement emails are generated; no marketing email is sent.

Resend preserves idempotency keys for a limited window; provider-side duplicate protection is not an indefinite guarantee. Monitor delivery failures, quota limits, sender authentication, complaints and unsubscribe rules as applicable.

## Fulfilment restrictions

- An email to a supplier is a **merchant-authorised purchase-order request**, not an automatic contracted purchase, accepted order, delivery guarantee or independent ethical certification.
- The supplier is merchant-declared. Real supplier identity, wholesale access, legal dropshipping terms, product-safety compliance, refunds and supply capacity must be independently assessed before commercial rollout.
- Product-supplier snapshots apply to **new orders** after migration 0004. Older order records may lack a snapshot and require manual review.
- Multi-supplier carts generate separate purchase order drafts. Sellers cannot prepare drafts for unpaid orders.
- Suppliers do not receive buyer addresses via these emails. The merchant must arrange data-minimised delivery securely under a lawful fulfilment arrangement.

## Next integration work

- Full Stripe sandbox purchase and webhook replay tests against real connected **test** merchant accounts, including chargebacks, charge failures, partial refunds, delayed events and inventory recovery.
- Product-specific VAT/tax treatment and shipping charges; chargeable postage is not currently included in the order cost model.
- Seller MFA, full identity/age/company checks, account recovery and production operational support.
- Supplier API/feed credential management, contracted order placement, safe delivery-information transfer and status reconciliation.
- Official marketplace OAuth/approval for eBay, Amazon, Etsy, TikTok and Shopify; WooCommerce remains review-gated draft publishing.
- Independent ethical audits, product category compliance, worker-protected reporting and consumer-law review.
- Privacy retention/deletion policies, support SLAs, fraud/security and accessibility audit, observability, backups and incident drills.

## How to validate

The repository CI runs `npm run check`, the Wrangler dry-run, local D1 migrations and `npm run smoke`. In staging, verify `/api/ready`, followed by a legitimate Stripe **test-mode** seller with signed test webhook events, Resend delivery to opted-in test recipients, authorised supplier-order drafts, shipping address access restrictions and after-sales refunds.

Never switch on live payments based only on unit tests.
