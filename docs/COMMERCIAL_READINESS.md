# Ethical Commerce: commercial modules and production gate

The following systems have been **implemented in source code**. This is not a statement of live readiness or provider approval.

## Modules and their boundaries

| System | Implemented | Gate before live use |
|---|---|---|
| Email verification | Expiring SHA-256 hashed challenges and transactional Resend emails, one-click confirmation, rate limits | `RESEND_API_KEY` and verified `EMAIL_FROM`; verify receipt on a real mailbox |
| Seller identity | Seller disclosures, legal seller contact, company registration, Stripe Connect Express onboarding and status reconciliation | Connected platform Stripe account; verified business identity and payouts; consent/legal review |
| Payments | Stripe Connect **direct charges** per approved seller, hosted Checkout, GBP/GB shipping, Stripe automatic tax, stock reservation, cancellation on expiry | `STRIPE_SECRET_KEY`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_TAX_ENABLED=true`, `SALES_ENABLED=true`, verified stores; fully tested tax/returns |
| Order processing | D1-trigger atomic stock reservation, order status, signed event/replay handling, scheduled reconciliation and expiry | Stripe sandbox scenarios, high-volume concurrent orders, refunds, webhooks and dispute tests |
| Fulfilment | Seller-managed supplier hand-off, acceptance, dispatch, delivery, carrier/tracking | Approved suppliers, contractual SLA, order-routing authorization and carrier feeds for full automation |
| Returns/rights | Customer token–scoped order lookup and complaint/refund/returns requests; seller decision and explicit Stripe refund endpoint | Consumer law/policy review; merchant support operations; notice delivery and regulated cancellation automation |
| Marketplace publishing | Merchant-owned encrypted WooCommerce and Shopify API credential records; WooCommerce **draft-only** listing creation | 32-byte `ENCRYPTION_MASTER_KEY`, `PUBLISHING_ENABLED=true`, `ALLOWED_PUBLISHER_DOMAINS`, explicit seller approval and external provider API authorization |
| Other channels | Existing CSV exports / queued connection placeholders | eBay, Amazon, Etsy, TikTok developer account, permission and marketplace policy approvals |
| Ethical evidence | Registered independent verifiers, mandatory accreditation reference, admin credential-review confirmation, signed assessment records with expiry/revocation and public status gating | Human credential checks, external assessment reports, independent review organisation and governance |
| Security | Existing CSP, CSRF, tenant isolation and D1 rate limits; added server-side merchant checks | WAF/Turnstile, MFA, privacy audit, third-party penetration test, incident response, monitoring, backups |

## Required environment and secrets

Set these as **Cloudflare Worker secrets**, not in GitHub or chat:

- `RESEND_API_KEY` — Resend transactional email API token.
- `EMAIL_FROM` — verified sender domain, e.g. a verified no-reply mailbox on your organisation's domain.
- `STRIPE_SECRET_KEY` — platform Stripe secret (test key first).
- `STRIPE_CONNECT_WEBHOOK_SECRET` — signing secret for Stripe Connect webhook deliveries to `/api/webhooks/stripe`.
- `ENCRYPTION_MASTER_KEY` — securely generated base64-encoded **32-byte** AES-GCM key; store and back it up securely.
- `ALLOWED_PUBLISHER_DOMAINS` — comma-separated reviewed WooCommerce outbound hostnames (no scheme).

Environment switches:

- `SALES_ENABLED` **unset / false by default**. Enable only after all commercial launch gates pass.
- `STRIPE_TAX_ENABLED` **unset / false by default**. Enable only after Stripe Tax obligations, classifications and jurisdictions are configured and tested on the connected account.
- `PUBLISHING_ENABLED` **unset / false by default**. Allow external WooCommerce draft publishing only after reviewing credentials, provider API ToS, allowed domains and product compliance.

No API keys, worker identity documents, passwords or webhook signing secrets are committed into the repository.

## Installation / schema upgrade

```sh
npm install
npm run check
npm run db:local
npm run smoke
# After reviewing the new migration in staging:
npm run db:remote
npm run deploy
```

Cloudflare's existing deploy command was configured to apply D1 migrations before deployment; the new `0003_commercial_foundations.sql` migration will run before the Worker replaces the previous version. **Take an appropriate backup before production schema changes**.

The release remains closed for public live selling even after deploying code. With `SALES_ENABLED` unset, checkout returns HTTP 503 and stores are paused by default. Public catalogue browsing can remain available.

## Stripe mode and provider configuration

Stripe Connect should receive **connected account** events for `account.updated`, `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired` and `charge.refunded`. Verify webhooks using Stripe's signing secret and live/test mode corresponding to the environment. Start with test mode.

**Important:** Stripe identity and payment onboarding do not by themselves establish seller legal compliance. Platform policies, safety assessments, taxes, refund processing and an operational support function must be approved separately. Fraud and tax classification vary by goods and destination.

## Critical scenarios to test before releasing trading

1. Sign up, verify an actual email through Resend and confirm invalid/expired tokens fail.
2. Complete connected account onboarding as a legitimate test seller, verify charges/payouts.
3. Complete all seller policies, validate published consumer contact and address.
4. Enter checkout with insufficient stock and verify no payment session or oversell.
5. Simulate two concurrent buyers purchasing the last inventory item; only one reservation succeeds.
6. Complete / cancel / expire Stripe test Checkout sessions and replay signed events; stock adjusts exactly once.
7. Run scheduled reconciliation after webhook delay, simulate Stripe API outage and recovery.
8. Test fulfilment and accessible customer request pathway with privacy protections.
9. Test partial and full refunds, chargebacks and false positive/negative payment statuses.
10. Confirm no supplier dispatch or marketplace publication occurs before explicit authorisation.
11. Verify independent assessments expire or revoke without showing verified badges.
12. Security test webhook signature, session privileges, tenant isolation, domain-based SSRF, brute-force protection and D1 quota exhaustion.
13. Review accessibility, consumer policy text, data handling and company obligations with competent human reviewers.

## Known limitations

This release is **not** a complete real-trading marketplace. In particular, marketplace OAuth approval, guaranteed product safety and ethical audits, supplier auto-fulfilment, carrier APIs, full international tax/shipping, chargeback evidence, independent protected whistleblowing and regulatory approval require external contracts, credentials and operational work. Do not claim them as live or certified.

See `docs/FULL_PRODUCT_SCOPE.md` and `docs/GO-LIVE.md` for the complete roadmap.
