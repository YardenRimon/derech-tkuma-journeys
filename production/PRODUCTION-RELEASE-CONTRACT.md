# Controlled production release and visitor consent

This code is prepared locally. It changes no live profile, provider, public domain, DNS, source WordPress, SDK, form delivery, payment or tracking setting. Synthetic test profiles are explicitly fixtures, not owner attestations or provider evidence. The existing Cloudflare review entry, Vite configuration, strict review validator, source preparation, review runtime and `visitor-policy.js` remain separate and unchanged by this implementation.

## Release boundary

`release-profile.mjs` validates an exact schema1 owner profile for `https://derech-tkuma.com`; `https://www.derech-tkuma.com` is its only alias. Every owner gate must be explicitly true: full source backup/restore, DNS/mail access, content/mobile acceptance, rollback, identity, source routing, provider connections, one-writer cutover preparation and final owner cutover approval. A profile pins the captured source release, full source commit, approval-receipt SHA256 and exact account/D1/R2 resources. No attestation is generated, inferred from a successful test or fabricated by code.

The separate `vite.production.config.ts` compiles that accepted profile and production capability into `build/production-worker.ts`. Absent compile constants, invalid profile or unknown origin always leaves production unavailable. Runtime stage/origin/source/scope must also match. Request headers, query strings, cookies, DOM attributes, local storage and window flags cannot enable production or remove review protection. The ordinary review build never compiles this capability. Its validator still rejects production routes/entry/resources.

The production Worker allows indexing only successful HTML for captured source routes and the accepted robots/sitemap responses. Admin, API, media, private measurement/configuration, assets and errors retain noindex. The www alias redirects only known public GET/HEAD identities to the fixed apex with query values discarded; it grants no mutation or alternate admin origin. Unknown hosts and invalid profile/scope fail closed. Internal public-response markers are removed before delivery.

## Source preservation, navigation and indexing

Production removes only the exact four-tag injected review-protection prefix and exact85-byte review visitor-module tag. It inserts a separate first guard and production consent module. All original source DOM, text, inline bodies, surviving script URLs/order and hash-only disabled tracking/payment comments remain. A missing/changed review insertion fails closed rather than using a broad noindex/CSP/script-removal pattern. All37 captured reconstructions are checked byte-for-byte after removing only the new insertion.

Existing captured canonicals are retained. The refund/privacy/terms/thanks source pages lack a canonical, so production adds a self canonical from their fixed captured route. The captured blog page2 canonical remains its source blog canonical. The four original noindex routes—`/refund_returns/`, `/מדיניות-פרטיות/`, `/תקנון-אתר/`, `/thanks/`—retain both their source HTML intent and HTTP noindex. The production sitemap deduplicates accepted identities and excludes these four:32 URLs from37 rendered routes. Review sitemap/metadata stay as before. No query value or request Host header becomes canonical metadata.

The production guard continues to block original WordPress/WooCommerce mutation paths, form submits, arbitrary source POST/XHR/beacons, legacy checkout URLs and direct Grow navigation. The parent CSP permits only same-origin connections, retains form-action none and never permits Google/Meta tracking on the source page. Only the dedicated consent frame may receive purpose-specific provider permissions. Native contact capture, when enabled by both profile and the existing server gate, runs before this guard and uses its fixed JSON/idempotency adapter. Footer/rating/quote remain outside that allowance. A blocked source form or Grow action shows one dismissible Hebrew alert referring to the existing WhatsApp/phone; it sends nothing and never claims success. `contactReady` and `paymentsReady` are explicit server-profile booleans, false in fixtures; unready public APIs are rejected before their handlers. A true contactReady additionally requires receive-only mode, exact apex CONTACT_ORIGIN,30day retention and UUIDv4 privacy authority in the accepted config. Payment readiness carries a separate nonsecret paymentEvidence object (Grow production/ILS, four evidence hashes and exact callback/acknowledgment contract); PAYMENT_CONFIG and PAYMENT_RATE_SECRET stay only in secret storage. Runtime compares the evidence fields and binds the secret payment config to the full final profile hash and approval receipt, without a cyclic config hash. Source SDK comments are never restored when a flag changes. Root owns the separately verified payment/order adapter.

## Consent and measurement

The production UI is Hebrew RTL using the existing green/cream/gold palette. Accept, reject and preferences have equal control sizes/visual priority. Optional analytics and marketing begin unchecked. Preferences and revoke remain accessible from a persistent button; form contact consent stays separate. There is no production consent UI or provider dispatcher on review.

The required `dt_privacy` choice stores only schema/policy/configuration revision, two purpose booleans and bounded timestamps. It uses Secure, SameSite=Lax, Path=/ and180day expiry. Oversize, duplicate, malformed, extra-field, wrong-version/revision and expired values are rejected. A changed integration revision requires a new choice. No identity, URL/query, form value, provider token or free text is stored. Missing/blocked persistence cannot silently restore permission after reload. Cross-tab updates reread the actual cookie; a broadcast payload cannot directly grant a purpose.

One analytics strategy is supported: **GTM only**, exact source container `GTM-5N7NPTL4`, GA4 destination `G-DV3E8J77EX`, Meta Pixel `766863783155971`. There is no second direct GA4 initialization and no source SDK restoration. A server/build-owned verified container contract must pin its revision and captured container SHA256 and attest basic purpose checks, no custom HTML, no personal-data/DOM variables, disabled enhanced automatic measurement and acceptance of the first-party frame behavior. Unverified/mismatched source IDs cannot load a provider. The accessible empty `GTM-N6ZC8824` is not this source container and cannot satisfy that contract; actual source-container access/configuration remains#31.

Google documents that tags can send cookieless measurements while consent is denied. This implementation uses basic blocking: the frame/SDK is absent until a valid purpose choice, and the server frame CSP also removes denied-purpose hosts. See [Google consent-mode overview](https://developers.google.com/tag-platform/security/concepts/consent-mode) and [consent implementation guide](https://developers.google.com/tag-platform/security/guides/consent).

The measurement document is same-origin, sandboxed with allow-scripts+allow-same-origin, and first-party/session cookie semantics are preserved. It is a **lifecycle boundary for audited code**, not an untrusted-code security boundary: same-origin vendor code could technically access its parent. The verified container must therefore exclude DOM/personal-data variables and custom HTML and use only the explicit event map. The empty measurement document has no source forms, receives no referrer, and has a fixed query-free URL. The server derives analytics/marketing host permissions from the bounded cookie; analytics-only cannot load Meta, and marketing-only cannot load GA4 even if a tag attempts the wrong purpose. If the choice cannot be persisted, the server keeps provider permissions denied.

Changing/revoking a purpose removes the complete SDK document, discards its queues/timers and recreates only the newly allowed context. Revocation clears only the known GA4/Meta cookies and persists both purposes denied. No delayed event is replayed after revoke. Already initiated requests cannot be recalled; this does not claim to delete previously delivered provider data. A normal first-party GA/session cookie and stopped future SDK timer requests were verified with an isolated synthetic browser provider, not the live container.

The data map is deliberately narrow:

| Browser event | Fixed allowed data | Meaning |
|---|---|---|
| page_view | pageKind home/tour/routes/quote/other | Page category viewed |
| whatsapp_click | placement home/tour/footer/other | CTA clicked; not an inquiry or message |

The container receives `dt_consent`, `dt_page_view` and `dt_whatsapp_click` with fixed `dt_*` keys; GA4 event names are page_view/whatsapp_click. Its explicit page_location is the fixed public origin and page_referrer is empty. No arbitrary URL/path/query, UTM, source form field, email, phone, free text, user ID, lead, booking, purchase or amount event is admitted. This is not a claim of historical campaign/source-measurement parity. Source-container review and an approved Preview/event mapping remain required before connection. The exact WhatsApp phone normalization preserves source CTA text and query bytes but never includes those bytes in measurement.

## Build and artifact checks

No ready owner profile or production deployment config is committed. Root supplies explicit private `DERECH_PRODUCTION_PROFILE_PATH` and `DERECH_PRODUCTION_CONFIG_PATH`, with full `PLATFORM_RELEASE_SHA`, only after genuine gates are satisfied. `scripts/build-production.mjs` requires Node24 and the exact clean source checkout. Its separate validator requires fixed apex/www routes, workers.dev/preview disabled, standalone production entry, exact pinned account/resources, verified shared Supabase identity/origin/scope and secret values kept in provider storage and observability explicitly disabled. It contains no deploy command or account/DNS mutation.

Production uses a separate `dist-production` output; a fixture artifact is never a release candidate. Root must add that generated directory to repository ignore policy. Preserve the ordinary review artifact and its unchanged validation. The generated Worker config includes DERECH_PRODUCTION_PROFILE_SHA256 over the canonical accepted profile. Validate that digest, the exact visitor asset bytes and production artifact against its accepted profile/resource/source identity before any later, separately authorized deployment. Root owns the future protected production CI/deploy template and final source/package-size verification.

Focused commands:

```
node scripts/test-production-profile.mjs
node scripts/test-production-workerd.mjs
node scripts/test-production-consent-browser.mjs
```

The browser test requires the pinned Playwright test runtime/browser; it creates a new temporary context and intercepts every URL. It never uses an existing user browser/profile and never loads a real provider. Local acceptance used the runtime-pinned Chromium headless shell under `/private/tmp`, with1440px and390px screenshots inspected in the private operational audit. Tests cover all37 source reconstructions, closed/forged profiles, strict resource gates, exact source IDs, cookie bounds/version, actual Worker public/private/error/alias behavior and per-purpose CSP, denied/reject zero SDKs, safe event fields, first-party cookies, revoke/no delayed calls/reload, and mobile overflow. Existing review visitor and native-contact HTTP tests still pass.

These checks establish local implementation behavior only. They do not establish source-container access/configuration, provider delivery, owner approval, public-domain cutover, production deployment, legal-policy approval or live measurement acceptance. Those distinctions remain mandatory.
