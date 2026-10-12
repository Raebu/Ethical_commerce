# Architecture and tenancy

## Worker + D1

All API routes are served from one Cloudflare Worker. The same Worker serves static assets through the ASSETS binding, avoiding separate hosting services. D1 stores accounts, sessions, stores, products, claims, evidence, trace events, supplier records, complaints, listings, and the audit log.

## Boundaries

- Store-scoped API operations always require a session and membership check.
- Only published products are visible publicly.
- Seller evidence never automatically becomes an independently verified statement.
- Public trace events only contain explicitly public-safe details; no personal employee information.
- Listing exports are real CSV files. External publishing requires provider OAuth, approved applications and adapter-specific validation.
- Orders and checkout are intentionally **not** represented as live until a compliant payment integration is implemented.
- Audit event hashes are tamper-evident indicators, **not** a blockchain or independent authentication of supplier truth.

## Recommended future split

1. Separate OAuth/connectors and webhook verification Worker, backed by Durable Objects or queues for retries.
2. Encrypted evidence document storage in R2, malware scanning and scoped signed URLs.
3. Seller billing and Stripe Connect, with legal marketplace responsibilities established.
4. Supplier remediation cases, protected whistleblowing, independent audit workflow.
5. GS1 Digital Link / EPCIS event mapping, multilingual DPP, product-category compliance rules.
6. Automated stock/reservation, returns, fraud controls and shipping integrations.

## Limits

Free Cloudflare allowances are usage-limited. No claim of unlimited free storage or traffic. Do not expose a public paid checkout until operational and legal reviews are complete.
