# Stripe / email sandbox commissioning (no real charges)

This runbook is for operators commissioning Ethical Commerce. The production Worker remains on the **existing D1 database**, with real payments, messages and publishing disabled unless separately approved.

## Confirmed provider availability

- A group-wide **live-mode Stripe account** is connected in the ChatGPT Stripe integration. It is **not an acceptable account for experimental charges**.
- The organisational domain `theraeburngroup.com` is verified in Resend for sending, but no Ethical Commerce-specific Resend API key is currently known to be installed in the Cloudflare Worker.
- These facts do **not** prove the Worker has credentials, that a Stripe Connect account is approved, or that sender deliveries have succeeded.

## 1. Create a separate Cloudflare staging environment

1. A separate staging D1 database was supplied with UUID `11d8e5ce-2bbb-491a-9099-b6e7085ea0a1` in Cloudflare account `e01b58b8d08d2c97284b2a46a13f3815`. Confirm its actual database name is `ethicalcommerce-staging`. Never reuse the production database ID `5070811a-9990-4ae3-bd72-cf394ee63be6`.
2. The GitHub staging workflow now defaults to the supplied staging UUID. It generates `wrangler.staging.toml` from `wrangler.staging.example.toml` and rejects production D1 reuse; it does not expose provider credentials. The Worker name will be `ethical-commerce-staging`.
3. From an authenticated terminal or Cloudflare build environment with D1 write permission, run:

   ```sh
   npx wrangler d1 migrations apply ethicalcommerce-staging --remote --config wrangler.staging.toml
   npx wrangler deploy --config wrangler.staging.toml
   ```

4. Check `https://YOUR-STAGING-WORKER.workers.dev/api/ready`. It should return `ready:true`. Create a **test** merchant account in this staging environment only; do not import real customers or supplier lists.
5. Keep every feature flag false until the appropriate test configuration and test-store onboarding are actually ready.


### Deployment from GitHub Actions

The workflow [.github/workflows/staging.yml](../.github/workflows/staging.yml) is available through the GitHub Actions **Staging deployment (isolated)** page. It can be invoked manually by entering `DEPLOY_STAGING_ONLY`, or by an authorised commit to `ops/staging-deploy-request.txt` on the protected `main` branch. Its default database UUID is already set to the separate D1 database. It will refuse to deploy if the repository / staging environment has no `CLOUDFLARE_API_TOKEN` secret. Configure an appropriately restricted Cloudflare token with Workers edit and D1 edit permissions under GitHub **Settings → Secrets and variables → Actions**, preferably scoped to the `staging` environment. Do **not** store this secret in the repository or chat.

Account ID `e01b58b8d08d2c97284b2a46a13f3815` is configured as a non-secret fallback; if an existing `CLOUDFLARE_ACCOUNT_ID` secret differs, correct it before running staging. Once the workflow finishes, inspect the actual Wrangler output for the staging URL and check `/api/ready`. The staging site is not verified or live merely because its configuration is committed.

## 2. Use Stripe test-mode keys, not the connected live account

Get a dedicated Stripe **test-mode** secret key and set it using Cloudflare's secure secrets UI for the *staging* Worker only:

- `STRIPE_SECRET_KEY` — starts with `sk_test_` or a supported test restricted key.
- `STRIPE_CONNECT_WEBHOOK_SECRET` — staging Connect webhook signature secret.
- Configure Stripe's test-mode Connect account and send its permitted events to `https://YOUR-STAGING-WORKER.workers.dev/api/webhooks/stripe`. Enable events: `account.updated`, `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired` and `charge.refunded`.
- Set `STRIPE_TAX_ENABLED=true` only after test tax settings have been reviewed; stage Checkout currently uses automatic tax for GBP UK shipping.

After a genuine staging store has completed its test seller disclosure + connected account review, and *only on staging*, set `TEST_CHECKOUT_ENABLED=true`. The server enforces `RUNTIME_TIER=staging` and a Stripe `sk_test_` / `rk_test_` key. An accidental live secret in staging, or a test secret in production, is rejected by the Checkout gate.

**Do not switch on `SALES_ENABLED` or `COMMERCIAL_LAUNCH_APPROVED` for commissioning.** Those are production gates.

## 3. Transactional email self-test

Create an Ethical Commerce-specific scoped Resend sending key, configure `EMAIL_FROM` as a plain email address (for example `no-reply@theraeburngroup.com` after confirming it is authorised), and add both values as Cloudflare secrets. Never paste the secret into chats, browser console output, repository files or a screenshot.

For an account deliberately granted `is_platform_admin=1` through a trusted Cloudflare database administration process, the following routes are available:

- `GET /api/commerce/admin/commissioning` — redacted checklist of server-side configuration; it returns booleans, deployment tier and mode only, never credentials.
- `POST /api/commerce/admin/test-email` — send a **single test email only to the signed-in operator's previously verified address**, with JSON body `{"confirm":"SEND_SELF_TEST"}`. Strict per-user throttling applies.

Email is never sent automatically by merely deploying the code. To commission actual transactional order mail, set `NOTIFICATIONS_ENABLED=true` on **staging** only after verifying the sender, rate limits, and test address delivery. Check delivery with Resend; an API-accepted email isn't proof of inbox receipt.

Note: creating a verified Resend sending domain does not by itself configure the Worker secret. Provider credentials must be installed explicitly in the correct Cloudflare Worker.

## 4. Test the complete order lifecycle

1. Create and verify a test seller's email, save legal/policy fields, onboard Stripe's **test** connected account, and verify charges and payouts (test status only).
2. Create a demo supplier and a demo product assigned to that supplier, then publish it on the staging store.
3. Start a GBP Checkout using a Stripe test card. Verify the order remains **pending** until the signed payment event arrives.
4. Confirm webhook signature, account, store, session ID, currency and subtotal; make sure the order transitions once, its inventory remains reserved, and fulfilment is created once.
5. Repeat the exact webhook; ensure no duplicate fulfilment or emails. Test expired sessions, payment failures, late paid events, lost Checkout references and recovery queue.
6. Configure the demo supplier's ordering contact (your own verified test mailbox only), explicitly approve a purchase-order email, and verify it contains items **but no customer personal delivery address**.
7. Enter test carrier/tracking details, request a return, and submit a Stripe test refund. Check notification queue delivery, recipient and content.
8. Test account isolation and platform-admin-only controls, plus customer cancellation, refund, chargeback and taxes. No fulfilment should be dispatched to a real supplier or customer.

The repository tests provide **simulated** HMAC-signed Stripe events and local D1 regression tests; a real Connect **test-mode** cycle must be completed before considering the platform commercially operational.

## 5. Production launch controls

The production Worker has `RUNTIME_TIER=production` in the tracked configuration. Live Checkout additionally requires **all** of:

- `SALES_ENABLED=true`
- `COMMERCIAL_LAUNCH_APPROVED=true`
- `STRIPE_TAX_ENABLED=true`
- `NOTIFICATIONS_ENABLED=true`
- A `sk_live_` / `rk_live_` key (test keys cannot activate production Checkout)
- A Stripe webhook signature secret, scoped Resend key and validated sender email
- Verified seller, account payout readiness, and public consumer disclosures.

Even these checks are not a substitute for supplier contracts, UK consumer rights, responsible product safety, privacy/accessibility reviews, ongoing security assurance, financial reconciliation and independent ethical verification.

Never turn on live payments or marketplace publishing as part of a staging or infrastructure smoke test.

## What still needs the operator to do manually?

Provision the distinct Cloudflare staging D1 database, obtain **test-mode** Stripe Connect access/keys, configure Cloudflare secrets, and approve the sender/test mailbox. Those steps cannot be completed solely from GitHub source control, and no credentials should be invented or committed.
