# Contact intake — prepared and disabled

This is backend preparation, not an activated public form or a connected delivery service. Native review forms/payment/tracking guards and original HTML remain unchanged. No provider request, customer message or live lead was created by development/testing.

## Source authority

`audit/source-integrations-2026-10-19.json` pins five captured form identities. Their IDs/post IDs are server-owned in `lib/contact-core.ts`:

| Form | Form ID | Post ID | Prepared intake |
|---|---|---|---|
| Home | 0899899 | 13 | Name, phone, email and contact consent; source actions known |
| Routes | af355f0 | 18 | Same contact fields; source actions known |
| Footer | 1b8a2d8 | 1489 | Disabled: backend routing not captured |
| Blog rating | c5cb8a0 | 5133 | Disabled: not assumed to be a contact lead |
| Quote/order | aa2b8e0 | 5982 | Disabled: backend, signature, order and delivery semantics pending |

Captured source actions on home/routes include storage, mail, redirect and webhook. This proves stored configuration only. It does not verify effective SMTP fallback, recipients, Make scenario ownership/behavior, current delivery or external idempotency. Raw webhook/recipients stay private and are never copied into this module or response.

## Request and storage

`POST /api/contact` accepts only JSON, at most10,000 streamed bytes, with exact request Origin and same-origin fetch context. Queries are rejected to prevent placing personal data in URL parameters. There is no permissive CORS behavior. Body-provided tenant/site/post IDs, webhook destinations or unexpected fields are rejected; the deployment scope and form metadata come from the server.

The future front-end adapter must generate and retain a UUIDv4 per submission, provide `formId`, `fullName`, `phone`, `email`, an empty `honeypot`, and explicit consent `{contact:true,policyVersion:'source-2026-10-19'}`. The consent version refers to the captured source wording; it is not marketing consent. No unchecked consent default or invented new terms are added. Unknown/false consent, controls, invalid contact details and honeypot content fail with fixed codes. Israeli phone formatting is normalized to international form. No free URL or arbitrary provider payload is accepted.

`D1Contacts` stores a single namespaced `cms_settings` JSON value containing the lead, consent timestamp, server receipt UUID, normalized payload fingerprint, source identity, revision and outbox state. Atomic INSERT OR IGNORE plus fingerprint comparison gives replay stability and rejects changed payloads under one UUID. Simultaneous equal submissions produce one record and one receipt; conflicting submissions produce one winner and a409. No new table, migration or schema change is required. The existing full settings backup now also covers these future records; protect it as personal data. No lead is currently collected on the review origin.

Public responses contain only `accepted`, opaque `receipt` and `stored_pending_processing`, or a fixed failure code. Acceptance means durable storage, not mail, WhatsApp, CRM or provider delivery. Responses/logs never contain name, phone, email, a provider error or secret. No redirect with personal query parameters is prepared; the existing `/thanks/` page can later be used without personal URL values.

## Delivery boundary and concurrency

`unconnectedMakeAdapter()` is intentionally disconnected and always fails with `routing_unverified`; it makes no fetch or message. There is no dispatch endpoint, scheduler, sender, bot or assumed CRM connection.

The internal claim API requires an explicit server-owned verified Make routing contract, exact scope/form allowlist and a contract SHA256. It moves pending_routing→sending with an atomic compare-and-swap revision and unique attempt token. Only one claimant wins. Provider outcomes settle through that same token into provider_accepted, unknown or failed. A provider_accepted outcome requires a validated acknowledgement hash and still does not prove email receipt. Unknown/failed/sending outcomes never automatically reclaim or resend; reconcile with the actual provider first. There is no lease-expiry retry that might duplicate an uncertain external action.

Future work must verify the exact source Make scenario, effective recipients/sender, payload mapping, response/timeout semantics and provider idempotency before implementing a transport. Provider secrets are not consumed by the prepared adapter. The verified contract is internal, not a value accepted from the public request.

## Exact environment and activation gates

- `CONTACT_MODE`: unset or any value except `receive-only` returns503 before storage. Keep unset on review.
- `CONTACT_ORIGIN`: when a later approved production activation occurs, must equal the exact canonical `https://derech-tkuma.com` or `https://www.derech-tkuma.com` and match the request origin. Native `.chatgpt.site`, localhost and arbitrary hosts always fail, even if the mode is accidentally set.
- Existing `CMS_TENANT_ID=derech`, `CMS_SITE_ID=derech-main`, isolated D1 binding and deployment-scope assertion remain required.
- No webhook, SMTP, Grow or messaging secret environment variable is currently consumed. Setting a secret cannot accidentally enable dispatch.

Before enabling production intake: root must validate source/offline contracts, verified Make/mail routing and an agreed test destination, provider idempotency/acknowledgement handling, abuse/rate-limiting controls, retention/deletion/access rules for personal leads, UI consent/error/retry behavior, and end-to-end non-duplicated test delivery. Footer/rating/quote remain separate pending contracts. An explicit receive-only mode is not evidence those acceptance gates passed.

## Focused verification

Run from `platform-cms`:

```sh
node --experimental-strip-types scripts/test-contact.mjs
node node_modules/typescript/bin/tsc --noEmit
```

The test uses actual adapter SQL on in-memory SQLite, not network mocks for persistence. It verifies all five IDs/post IDs against the captured audit; two known contact schemas; consent and input rejection; private source scope; replay/conflict/concurrent insertion; atomic claim; stale token/uncertain delivery handling; provider-disconnected behavior; PII-free responses; review fail-closed; origin, content type, query and streamed size boundaries. No full app test command or build configuration was changed by this bounded addition; root owns final integrated checks and CI inclusion.
