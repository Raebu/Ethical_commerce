# Payment recovery and Stripe commissioning

**Status:** Implemented with signed simulated Stripe Connect webhook and local D1 tests. Not approved for live payments. The platform's `SALES_ENABLED` and `COMMERCIAL_LAUNCH_APPROVED` gates remain off by default.

## Why an incident queue is necessary

A Stripe Checkout API timeout can happen *after* Stripe has created a valid payment session. Automatically returning reserved inventory to stock would allow another buyer to purchase it while a delayed payment still completes. The merchant could then have two buyers for the same item.

To avoid that risk, ambiguous Checkout API or D1 persistence results **retain the stock reservation** and record a payment incident requiring operator review. Signed payment events with a matching connected Stripe account, store, order and subtotal can restore a previously unpersisted session reference when an incident exists. A signed payment event for an order already cancelled/stock-released is **not fulfilled** and is escalated.

The operator review API is restricted to platform administrators:
- `GET /api/commerce/admin/payment-incidents` — review open payment exceptions
- `POST /api/commerce/admin/payment-incidents/:id` — annotate `in_review` or `resolved` after a verified provider check, with a note at least 20 characters and `confirmManualProviderReview: true`.

Review status is an administrative record. It **never** issues refunds, marks an order paid or restores stock. If a payment succeeded after cancellation, customer-service staff must handle the charge/refund and stock allocation explicitly. Do not tell customers an order is confirmed until Stripe is reconciled and the order's state is correct.

## Operator response

1. Review the incident queue and the local order and Stripe session references. Do not forward buyer tokens, addresses or sensitive payment details to anyone without access rights.
2. In the **correct Stripe account and mode**, verify whether a Checkout Session or PaymentIntent exists and whether payment is paid, unpaid, refunded or disputed.
3. For a known successful payment and a reserved order, let the authenticated webhook/reconciliation process record it and confirm fulfilment is created. If stock has already been released, do not dispatch automatically; review capacity and offer a refund or lawful remedy.
4. For an ambiguous API timeout with no stored session, investigate in Stripe first. Do not release stock until the possible payment is ruled out.
5. Record the review finding and resolution note through the admin endpoint and retain the evidence in the operational case record.
6. Independently verify customer notifications, support requests, and any compensation/refund. Never assume an outbound email or Stripe refund succeeded without provider confirmation.

## Validation

The `tests/payment-recovery.test.ts` suite builds the complete local D1 schema, creates representative orders, signs Stripe-like webhook events using HMAC-SHA256, and verifies:

- valid signed Connect payment processes an order once and queues its receipt/owner notice;
- duplicate event replay cannot duplicate the order or notifications;
- an invalid signature cannot change anything;
- a session mismatch is recorded for review rather than confirmed;
- a late paid event against a cancelled order cannot fulfil it silently;
- a known Checkout persistence incident is allowed to link a validated signed session;
- the periodic reconciler does not release stock for a lost/unconfirmed session.

The usual `npm run check`, local migrations, Cloudflare `wrangler deploy --dry-run`, and end-to-end smoke suite are also required.

## External blocking conditions

There is a connected **live-mode Stripe business account**, but a developer sandbox/test account has not been available through the connected tools in this session. Do not test using real charges or use live platform keys as substitutes for a sandbox. Configure a separate test-mode Stripe Connect environment, including its own webhook signing secret, and test legitimate seller onboarding, tax/shipping calculation, success, failure, cancellation, refunds, retries, disputes, and receiving email before opening public trading.

A verified organisational Resend sending domain is available, but that does not prove this Worker currently has the scoped Resend API secret or that its transactional delivery has been tested. Set Cloudflare secrets outside the repository and conduct a **consented test-address** delivery test only after deliberate approval. Do not send messages to actual customers or suppliers as part of commissioning.

As before, no public trading or external publishing may be enabled without commercial, legal, security, supplier and independent ethical assurance reviews.
