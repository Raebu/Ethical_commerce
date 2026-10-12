# Full Ethical Commerce vision and delivery status

This document is the single feature inventory for the proposed Shopify alternative and ethical supply-chain platform. **A completed technical foundation is not the same as approved public trading.** Each feature is marked implemented, foundational or pending.

| Area | Feature | Status |
| --- | --- | --- |
| Storefronts | Mobile-responsive public shopping catalogue and individual hosted store pages | Implemented |
| Merchant control | Accounts, store separation, products, inventory, suppliers and branding | Implemented |
| Traceability | Supplier declarations, production stages, time/place/actors and missing stages | Implemented |
| Product passports | Public passports, facet-specific claims and evidence-status display | Implemented |
| Trust | Seller cannot self-issue independently verified status | Implemented |
| Seller channels | Downloadable CSV catalogues, manual channel preparation statuses | Implemented |
| Consumer welfare | Public concern submission with restricted seller review | Implemented, anti-spam pending |
| Governance | Tamper-evident operational audit entries | Foundational, concurrency hardening pending |
| Seller onboarding | Verified email, MFA, supplier identity, tax and payout checks | Pending |
| Checkout | Stripe Connect, receipts, tax, safe payment lifecycle, refunds | Pending |
| Orders | Order state machine, idempotency, inventory reservation, shipping/returns | Pending |
| Distribution | Approved eBay, Amazon, Etsy, Shopify, WooCommerce and TikTok OAuth adapters | Pending |
| Dropshipping | Contracted supplier feeds, stock synchronisation and automated fulfilment | Pending |
| Ethical verification | Independently reviewed documents, audit provider credentialing, expiry/revocation | Pending |
| Supply chain | GS1 identifiers, EPCIS 2.0, Digital Product Passport category compliance | Pending |
| Human rights | Worker-centred due diligence, safe remediation, protected reports, independent response | Pending |
| Planet | Emissions/water footprint methodology, impact calculation and independent evidence | Pending |
| Animals | Category-specific welfare assurance, certification verification | Pending |
| Pricing | Full final basket totals, taxes, shipping cost, fee disclosure, consent UX | Pending |
| Product longevity | Repair support, spare parts, second-hand and refurbished marketplace flows | Pending |
| Platform fairness | Verified buyer reviews, disputes, seller appeal process, ranking disclosure | Pending |
| Privacy | Data export/erasure, records of processing, retention, DPIA, consent workflow | Pending |
| Accessibility | WCAG 2.2 AA formal audit with real user testing | Pending |
| Global trade | Languages, currencies, tax rules, import/export and cross-border shipping | Pending |
| Platform management | Admin console, moderation, subscription-free funding operations, health monitoring | Pending |
| Risk | Stronger auth, abuse prevention, DDoS/WAF, secrets, encrypted evidence files and backups | Pending |

## Design rules

1. Ethical claims are not created from AI speculation; every assertion has provenance or an explicit absence of provenance.
2. Human-rights abuses and safety concerns cannot be offset by unrelated positives.
3. Data supplied by a merchant is labelled as such and never automatically upgraded.
4. Do not silently publish to a channel or dispatch an order without an authorised, functioning integration.
5. Merchants see costs upfront, including third-party costs. The core platform has no required subscription for an initial free-tier deployment, not unlimited free service.
6. No fabricated product reviews, dark patterns, fake countdowns or misleading rankings.
7. Protect workers and reporters from retaliation; design specialised access controls before collecting sensitive complaints.
8. A complete supply-chain view requires verifiable cooperation from upstream producers, not just an attractive flowchart.
9. Stay within provider API terms and the customer's legal jurisdiction.
10. Include implementation tests and documented release gates for each milestone.

## Delivery sequence

**A — Technical foundation (this branch).** D1 commerce data model, account/store management, storefronts, passports, channels CSV, basic concerns, CI, local smoke tests.

**B — Safe trading.** Identity verification, Stripe Connect, idempotent payments/orders, fulfilment, refund paths, tax and consumer-law documentation, monitoring/security.

**C — Approved ecosystem.** Per-marketplace OAuth adapters, supplier catalogue and fulfilment contracts, feed validations, inventory synchronisation, reconciliations.

**D — Evidence assurance.** Independently accredited assurance partners, GS1/EPCIS mapping, verifiable credentials, certificate expiry/revocation, supplier remediation, human-rights protections.

**E — Global ethical commerce.** Accessible visual store designer, multilingual sales, circular product flows, data-rights centre, impact methodology and transparent fairness governance.

Never label B-E complete until real integrations and end-to-end tests have passed.
