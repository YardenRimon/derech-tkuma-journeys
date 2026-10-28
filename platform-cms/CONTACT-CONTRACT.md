# Contact intake, protection and delivery — prepared and disabled

This is backend preparation, not an activated public form or a connected delivery service. Native review forms/payment/tracking guards and original HTML remain unchanged. Development/tests created no live lead, customer message or external provider request. Transport tests use a loopback-only HTTP fixture.

## Source authority

`audit/source-integrations-2026-10-19.json` pins five captured form identities. Their IDs/post IDs are server-owned in `lib/contact-core.ts`:

| Form | Form ID | Post ID | Prepared intake |
|---|---|---|---|
| Home | 0899899 | 13 | Name, phone, email and contact consent; source actions known |
| Routes | af355f0 | 18 | Same contact fields; source actions known |
| Footer | 1b8a2d8 | 1489 | Name, phone, email, required acceptance and optional message; source actions known |
| Blog rating | c5cb8a0 | 5133 | Disabled: not assumed to be a contact lead |
| Quote/order | aa2b8e0 | 5982 | Disabled: backend, signature, order and delivery semantics pending |

The private original export audited on 28 October 2026 verifies the footer `1489/1b8a2d8` widget, required name/phone/email/acceptance, and optional `message` textarea. Its actions are storage, email, redirect and a webhook distinct from home/routes. Rating and quote remain separate unsupported workflows. Public code contains only form/post identities and field contracts; the original private audit and export retain routing/mail settings.

Captured source actions on home/routes/footer include storage, mail, redirect and webhook. This proves stored configuration only. It does not verify effective SMTP fallback, recipients, Make scenario ownership/behavior, current delivery or external idempotency. Raw webhook/recipients stay private and are never copied into this module or response.

## Request and storage

`POST /api/contact` accepts only JSON, at most10,000 streamed bytes, with exact request Origin and same-origin fetch context. Queries are rejected to prevent placing personal data in URL parameters. There is no permissive CORS behavior. Body-provided tenant/site/post IDs, webhook destinations or unexpected fields are rejected; the deployment scope and form metadata come from the server.

The prepared native client generates and retains a UUIDv4 per submission, provides `formId`, `fullName`, `phone`, `email`, a honeypot value, and explicit consent `{contact:true,policyVersion:'source-2026-10-19'}` from the existing unchecked source checkbox. The consent version refers to the captured source wording; it is not marketing consent. No checked default or invented new terms are added. Unknown/false consent, controls, invalid contact details and honeypot content fail with fixed codes. Israeli phone formatting is normalized to international form. Only footer accepts optional `message`: omitted or empty becomes an empty string; NFC/CRLF normalization preserves multiline content. A technical 2,000-character limit and control-character rejection bound intake; this is an implementation limit, not a captured source maximum. Home/routes reject a message field. Message joins the stored private fields and fingerprint, so changed message content under one UUID conflicts. It follows the same encrypted settings backup, 30-day configured retention, restricted reads, erasure markers and whole-record tombstone deletion as other contact fields. No free URL or arbitrary provider payload is accepted.

## Native public wiring boundary

`preparePublicContacts` in `lib/contact-client.ts` is called only by the public page route. It inserts one early script only when the existing deployment-owned receive-only gate and exact canonical production request URL origin both pass, and only on source pages containing a verified contact widget, including the shared footer across the captured pages. The script is entirely absent on review, including receive-only misconfiguration and forged Origin/Host/browser flags. Removing that one insertion restores the original source HTML byte for byte; source fields, labels, consent copy and script order are retained. The separate visitor policy remains unchanged.

The client captures a private native fetch reference before the retained guard patches global fetch. Its window capture listener handles only the exact `0899899/13`, `af355f0/18` and `1b8a2d8/1489` form/post pairs; it stops the event before both the document guard and Elementor can submit it again. It posts strict JSON to the constant same-origin `/api/contact/` path, with redirects rejected and no personal URL values. All other forms still reach the retained blocking guard; no rating/quote or old WordPress submission handler is enabled. The global review guard is never lifted.

Pending submissions retain their UUID in memory and, when available, session storage containing only that UUID. Network failure, timeout, malformed acknowledgement or reload does not silently generate another key. There is no automatic retry. Changed fields under that key receive and explain the server409 conflict without generating a fresh attempt. A validated202 `stored_pending_processing` receipt disables repeat submission on that page and displays only that the details are stored awaiting processing plus the opaque reference. It does not say a message was delivered, someone received it, or a person will contact the visitor. No source thank-you redirect is assumed. Storage-unavailable browsers retain retry identity only while that page remains open.

`D1Contacts` stores a single namespaced `cms_settings` JSON value containing the lead, consent timestamp, server receipt UUID, normalized payload fingerprint, source identity, revision, pinned expiry and outbox state. Atomic INSERT OR IGNORE plus fingerprint comparison gives replay stability and rejects changed payloads under one UUID. Simultaneous equal submissions produce one record and one receipt; conflicting submissions produce one winner and a409. Existing settings backup covers leads, minimal deletion tombstones and access receipts; protect it as personal data. Migration `0008_contact_controls.sql` adds only transient `contact_rate_limits` counters, excluded from the archive and recreated empty on recovery like auth counters. It must be applied before intake is configured. No lead is currently collected on the review origin.

Public responses contain only `accepted`, opaque `receipt` and `stored_pending_processing`, or a fixed failure code. Acceptance means durable storage, not mail, WhatsApp, CRM or provider delivery. Responses/logs never contain name, phone, email, a provider error or secret. No redirect with personal query parameters is prepared; the existing `/thanks/` page can later be used without personal URL values.

## Abuse controls before lead storage

The real public route checks the existing production-origin/mode gate, request headers and required retention setting before DB access. It then verifies deployment/D1 scope and consumes an atomic ingress counter **before parsing contact fields**. The edge-owned `CF-Connecting-IP` is required; body IDs, `X-Forwarded-For` and arbitrary actor headers never select buckets. Counters store only scope/window-specific SHA256 keys, counts and expiry; raw IP/contact fields are absent. Missing counters, invalid bindings or storage errors fail closed.

Technical limits are30 requests/minute per IP,5 new leads/10minutes per IP and200 new leads/hour per site. New-lead reservations run after an existing UUID/fingerprint replay check and before INSERT. A valid replay can therefore return the same receipt after the new-lead quota is used. Conflicting payloads still fail409; ingress limits continue to apply to every request. Atomic SQL makes concurrent reservations obey these limits. Responses use fixed429 `rate_limited` with Retry-After60, no user values. Each ingress deletes at most100 expired counter rows; counters remain separate from personal lead storage.

## Retention, deletion and restricted access

`CONTACT_RETENTION_DAYS` is required by the backend, with no default or inferred business policy. The root task selected30days as an engineering duration for the temporary incoming contact queue. It is not a payment, booking or legal-document retention policy. The implementation accepts only an explicitly configured integer1–3650; there is no automatic default. Each new lead pins its duration and UTC expiry. A shorter current policy takes effect for existing records; increasing the setting cannot extend a previously pinned expiry. Legacy prepared records without expiry use their server creation time plus the configured duration.

Expired records cannot be returned by private reads, claimed for delivery or replayed as accepted. Expiry/revision-guarded erasure replaces the entire settings value with a minimal schema2 tombstone: scope, opaque original UUID, revision, erased time/reason and optional verified operator ID. Name, phone, email, optional message, consent, public receipt, payload fingerprint and delivery tokens are removed. Tombstones intentionally remain to prevent a late retry under the same UUID from recreating erased personal data; such retries return410 `submission_erased`. A stale deletion revision fails409. Deletion never recreates a sending/unknown provider attempt or claims to retract a provider message.

The existing verified CMS identity, active membership and system-admin role protect **POST only** `/api/contact/manage/`. Its JSON commands are:

```json
{"action":"read","key":"<submission UUID>"}
{"action":"erase","key":"<submission UUID>","expectedRevision":1,"confirmed":true}
{"action":"expire"}
```

Scope comes from the deployment. Extra fields, query strings, wrong Origin/fetch context/content type, unauthenticated/forged identities and content editors are denied. Read/CAS SQL rechecks that the actor is still an active system administrator with the same managed identity. An audit receipt containing only scope, UUID, revision, actor ID, operation and time is durably stored before private contact fields are returned. Replies are private/no-store/noindex with no-referrer. There is no public browse, search, export or delivery-dispatch endpoint.

`Contacts.expire` supports at most100 matching records per call and cleans at most100 old access receipts under the same configured duration. Actual public, admin and machine maintenance use only **2 records per pass** to fit the measured Free Worker execution budget. `maintainContacts` is the root integration hook for the existing signed/scoped execution gateway, under its existing lock. It processes2 reconciliation rows plus2 expired rows and persists a server-owned reconciliation cursor. It adds no packet field, endpoint, key, sender, poller or timer. The gateway's existing cadence cleans a quiet site; root owns installation and verification of that hook. Reports contain fixed counts/cursors, never contact fields. Expired data remains inaccessible through these interfaces even if cleanup is delayed.

Deletion persists and verifies an immutable R2 marker **before** changing D1. The existing isolated `BUCKET` stores markers at `privacy/contact-erased/v1/<tenant>/<site>/<UUIDv4>.json`; objects contain only scope, opaque UUID, UTC time and reason, with no operator/person/payload/provider fields. Conditional creation never overwrites an earlier marker. A nonsecret deployment-pinned `CONTACT_PRIVACY_AUTHORITY_ID` must match an immutable per-scope `authority.json` in that prefix. Deliberate initialization uses `initializeContactPrivacyAuthority`; intake/restore never auto-initializes an empty bucket. Missing/mismatched authority, unreadable R2 or malformed markers fail503, rather than treating unknown erasure state as absence.

Submit, private read, delivery claim and settlement consult that authority. An existing marker denies access/replay and redacts a resurrected D1 value to a tombstone. The media route accepts UUID keys and image content only; these slash-prefixed JSON objects are not media and must never be public. Root backup inventory must validate/exclude only these exact private keys and retain rejection of arbitrary non-UUID keys. `parseContactPrivacyKey` is the shared strict classifier, including the authority key.

Encrypted historical backups can contain earlier personal data until the existing archive rotation expires them. Markers are independent of those archives and must never be expired, deleted or overwritten by media rollback/restore. `reconcileContactRestore` processes2 records per invocation: start with null cursor, follow every returned cursor to `ready`, and keep restored contact intake/delivery disabled until that gate finishes. It reads current R2 authority and applies both erasure markers and current expiry, so an earlier D1/settings snapshot cannot resurrect an erased lead. Reusing a stale archived maintenance cursor is insufficient. Root owns the restore/inventory integration and preservation of the pinned authority. This does not claim to retract an in-flight provider request or erase its existing copies; the verified provider's retention/deletion remains part of its connection contract.

## Delivery boundary and concurrency

The default `unconnectedMakeAdapter()` remains disconnected. `contact-delivery.ts` now provides an isolated complete transport callable only by trusted server code; public intake never invokes it. There is no dispatch endpoint, scheduler, sender, bot, mail fallback or assumed CRM connection. Mail delivery, if provided by the actual Make scenario, remains that existing scenario's responsibility.

`verifiedMakeContract` accepts an exact server-owned schema1 contract: verified Make kind, exact deployment scope, unique allowlist of the verified contact form IDs, a fixed HTTPS Make webhook endpoint, an explicit seven-field payload mapping for home/routes or eight-field mapping including message for footer, verified provider idempotency header, exact JSON acknowledgement status/field/value/receipt field and bounded100–10000ms deadline. Nothing comes from the public submission. Footer contracts must contain only the footer identity; home/routes contracts cannot add a message mapping. Unknown fields, unverified contracts, rating/quote forms, arbitrary destinations, redirects, query/fragment/userinfo/ports, incomplete field mappings and implicit acknowledgements fail closed. Endpoint/credentials/recipient routing stay private. The transport emits only the configured fields, constant verified destination and stable opaque server receipt as the configured idempotency key; it does not accept a recipient/sender or add a second mail service.

`deliverContact` validates that contract before claiming the stored record. Claim moves pending_routing→sending with a SHA256 contract identity, atomic revision compare-and-swap and unique attempt token. Only one claimant wins. The same token settles the result. A provider_accepted result requires the exact configured status plus a maximum2048-byte valid JSON acknowledgement containing exactly the configured success field and a bounded provider receipt. Only a hash of the provider receipt is retained. Provider acceptance still does not prove email receipt or human action.

Network failure, redirect, unexpected status/content type, malformed/oversize acknowledgement and deadline across headers/body settle to `unknown`. Requests reject redirects, omit browser credentials/referrers and make exactly one attempt. Sending/unknown/failed/accepted states never automatically reclaim or resend; reconcile the actual provider first. Failed persistence after a request leaves sending and likewise requires reconciliation. Response bodies/provider errors/destinations/PII are never returned or logged by the adapter.

Source routing/recipients/sender/scenario ownership, effective payload/idempotency and acknowledgement contract still require verified provider configuration and an approved end-to-end test destination. The loopback fixture demonstrates implementation behavior; it is not provider verification or delivery evidence. No production contract or credential was fabricated or installed.

## Trusted signed execution caller

`lib/contact-execution.ts` exports `dispatchOneContact(db,bucket,scope,config)`. The actual signed machine execution handler invokes it immediately after bounded maintenance under its existing authenticated deployment scope and execution lock. No new request field, endpoint, timer, sender, delivery queue, fallback or retry is created. Its fixed result/opaque receipt is not copied into general execution reports.

Absent `CONTACT_DELIVERY_MODE=verified-make`, the hook returns disabled without any database, privacy-bucket or provider I/O. An active mode additionally requires a secret-storage `CONTACT_DELIVERY_SECRET` containing either the legacy exact strict Make JSON contract above or an array of one or two such contracts, plus a nonsecret `CONTACT_DELIVERY_CONTRACT_SHA256` equal to SHA256 of the **exact UTF8 secret JSON bytes**. The entire array is verified before I/O: overlapping form allowlists, duplicate endpoints, empty or more-than-two sets fail closed. Footer and home/routes can coexist only with distinct endpoints and complete independent field/acknowledgement/idempotency contracts. Hash mismatches, invalid source/scope/endpoint/fields/proofs, missing explicit retention or invalid privacy authority fail before selecting anything. Secret values/destinations/provider errors are never reported. The nonsecret digest pins the independently reviewed secret, and does not make the secret public or prove actual provider acceptance.

The dispatcher imports the same compiled offline Jerusalem sacred-time calendar and pure policy as `independent-monitor`. It verifies its complete canonical JSON-plus-newline SHA256 against the exact reviewed pin once per isolate/dispatcher. That calendar includes the reviewed Israel holidays and120second pre-closure margin; the dispatcher additionally requires the shared12second operation lookahead. Modified, malformed, expired, out-of-range or uncertain calendars hold the operation with no I/O. No remote calendar, weekday approximation, request flag or environment override can grant permission. It rechecks at selection, immediately before/after the existing claim, immediately before the one provider attempt and immediately before settlement. A closure after claim leaves sending frozen for provider reconciliation; reopening never resends it automatically.

Candidate SQL returns only one opaque key/revision and public source form identity across the complete contract set, restricted to schema1 pending_routing records in derech/derech-main, a form ID allowed by the validated contract, and the exact verified source form/post pairs0899899/13, af355f0/18 or1b8a2d8/1489. The exact candidate form chooses its own already validated immutable contract; there is no fallback route. It reads no contact fields during selection. The existing `deliverContact` performs the only CAS claim and settlement; it is not preclaimed. Its guarded service/fetch wrappers preserve authoritative privacy/expiry checks and check privacy again before the provider call. Erased/expired/unknown-authority records never reach the provider. At most one provider request can occur; unknown/sending/failed/accepted records cannot be automatically selected again. Results contain only a fixed state and, on successful settlement, the opaque original receipt. Provider acceptance remains distinct from downstream mail receipt or human action.

`test-contact-execution.mjs` uses real SQLite, the actual signed machine route and existing lock, the exact shared calendar and a loopback-only synthetic provider. It proves signature/overlap denial, zero I/O when disabled or misconfigured/held, all121 closure intervals and12second horizons, full calendar SHA rejection, bounded scoped selection, competing CAS claims, immutable erasure/expiry denial, malformed/stream-timeout unknown without retries, and closure before claim/provider/settlement. Fixtures are not provider configuration or end-to-end delivery approval.

## Exact environment and activation gates

- `CONTACT_MODE`: unset or any value except `receive-only` returns503 before storage. Keep unset on review.
- `CONTACT_RETENTION_DAYS`: explicitly30 for the temporary incoming queue, with no code default. It is not browser-controlled.
- `CONTACT_PRIVACY_AUTHORITY_ID`: nonsecret pinned UUIDv4 matching the deliberately initialized private R2 authority manifest; missing/mismatched/unknown authority fails closed.
- `CONTACT_ORIGIN`: when a later approved production activation occurs, must equal the exact canonical `https://derech-tkuma.com` or `https://www.derech-tkuma.com` and match the request origin. Native `.chatgpt.site`, localhost and arbitrary hosts always fail, even if the mode is accidentally set.
- Existing `CMS_TENANT_ID=derech`, `CMS_SITE_ID=derech-main`, isolated D1 binding and deployment-scope assertion remain required.
- `CONTACT_DELIVERY_MODE`: unset by default; only `verified-make` admits the trusted caller after all configuration/calendar/privacy gates.
- `CONTACT_DELIVERY_SECRET`: secret-storage strict Make JSON contract only after actual source/provider routing approval. Never a public Worker var, URL, repository setting or log value.
- `CONTACT_DELIVERY_CONTRACT_SHA256`: nonsecret64lowercase-hex SHA256 of exact accepted secret JSON bytes; must match before selection. A secret alone cannot activate dispatch.
- No SMTP, Grow, messaging sender or additional delivery system is introduced by this hook.

Before enabling production intake: root must validate source/offline contracts and the contact migration/backup integration, the chosen30day queue duration, verified existing signed maintenance hook and backup/restore erasure-authority preservation, verified Make/mail routing and an agreed test destination, effective provider idempotency/acknowledgement handling, UI consent/error/retry behavior, and end-to-end non-duplicated test delivery. Footer/rating/quote remain separate pending contracts. An explicit receive-only mode is not evidence those acceptance gates passed.

## Focused verification

Run from `platform-cms`:

```sh
node --experimental-strip-types scripts/test-contact.mjs
node scripts/test-contact-client.mjs
node scripts/test-contact-http.mjs
node scripts/test-contact-controls.mjs
node scripts/test-contact-execution.mjs
node node_modules/typescript/bin/tsc --noEmit
```

The tests use actual adapter SQL on in-memory SQLite, not network mocks for persistence. They verify all five IDs/post IDs against the captured audit; two known contact schemas; consent and input rejection; private source scope; replay/conflict/concurrent insertion; atomic claim; stale token/uncertain delivery handling; provider-disconnected behavior; PII-free responses; review fail-closed; origin, content type, query and streamed size boundaries. Native client tests run the actual retained guard together with the client, verify source-preserving production-only insertion, Elementor duplicate prevention, same-key uncertain/reload retry, honest receipt wording, and unknown-form rejection. HTTP tests call the real public/contact route functions with SQLite persistence and only isolated deployment bindings. The controls suite also exercises atomic quotas and storage denial under concurrency, required retention configuration, policy shortening, immutable marker/authority checks, older-snapshot redaction, bounded full restore reconciliation, quiet-site maintenance, expiry/erasure/no resurrection, current admin SQL revocation/access audit, the actual management route authorization/CSRF/revision boundary, strict routing validation and real loopback HTTP acceptance/malformed/oversize/redirect/deadline behavior without external calls. Root owns integrated checks, migration/backup/CI inclusion, operational maintenance and live acceptance. Root installation/verification of the prepared migration, maintenance and restore hooks plus verified provider/end-to-end delivery remain activation gates; this preparation activates none of them.

## Trusted CMS transport and public review separation

The optional verified Make hook belongs to the private CMS machine workflow. It may be configured explicitly for an approved end-to-end test or after public cutover when the accepted production profile reuses the isolated CMS resources. It is not a browser/release-stage opt-in: signed scope, explicit secret JSON plus exact SHA256, accepted routing and the shared time gate are all required. Public review intake remains disabled by its exact-origin gate, regardless of these transport settings. No live delivery configuration is installed merely by committing this code. Provider acceptance and actual recipient delivery remain distinct.

## 28 October 2026 — local footer migration acceptance

Offline tests cover all captured pages with production-only script insertion, unchanged source HTML after removing that insertion, exact footer pair/message capture, rating/quote/wrong-post blocking, multiline and empty-message validation, message-sensitive idempotency, deletion, and simultaneous disjoint routing with at most one candidate/claim/provider attempt. Legacy single-contract configuration remains supported. Only synthetic loopback delivery was exercised; no provider configuration, credential, deployment, source thank-you redirect, mail recipient or public intake was activated. Original 982 assets remain unchanged.
