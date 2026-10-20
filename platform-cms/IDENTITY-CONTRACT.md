# Shared platform identity adapter

Supabase Auth owns identities, password hashing, Google OAuth and TOTP factors. The CMS uses a request-scoped server client with a publishable key only. The managed identity foundation is shared; the existing CMS membership adapter remains scoped to the Derech pilot. This does not establish a complete multi-tenant platform membership service.

## Fixed build modes

`PLATFORM_AUTH_MODE` is fixed by the build: `sites`, `cloudflare-access`, or `supabase`. A request cannot select a mode. The review rollout first retains Cloudflare Access while Google/MFA acceptance is pending. Supabase mode strips caller-supplied identity headers, verifies the exact provider session remotely, requires AAL2 and then checks active CMS membership, site scope and action grants. The stable provider subject is pinned independently from legacy identity pins; mismatches fail closed.

The reviewed Supabase URL is `https://uawcxvkekfqxosfblpxr.supabase.co`; the review application origin is `https://derech-tkuma-review.22yarden22.workers.dev`. Store `PLATFORM_AUTH_SUPABASE_PUBLISHABLE_KEY` in the Worker vault. Do not configure service-role keys. Global enrollment must remain restricted by the managed provider's before-user-created hook to owner-approved Google identities. Never open unrestricted signup or write directly to `auth.users`.

`PLATFORM_AUTH_EMAIL_OTP_READY` defaults to false and accepts only the literal string `true`. Keep it false until a general-platform sender domain, SMTP transport and eight-digit OTP template are verified with the approved recipients. Disabled OTP is shown honestly in the UI and rejects before contacting the provider. Domain selection is deferred by the owner and is separate from the customer-domain migration.

## Session and privilege boundaries

The browser receives only same-origin HttpOnly/Secure/host-only cookies and a CSRF token, never provider access or refresh tokens. Google uses PKCE, a bound ten-minute flow state and a safe local return path. Mutations require an exact origin and CSRF. A password can be set only after AAL2; the user enters any personal new credential. D1 limits attempts by hashed IP/account/subject; transient counters fail closed and expire in bounded cleanup.

Google authentication does not create a CMS member or grant. CMS roles and action/site restrictions remain authoritative on each operation. Machine execution and backup use existing independent HMAC capabilities and do not inherit browser identity. All review pages remain noindex.

## Acceptance and recovery

Focused checks cover forged headers, callback state replay, PKCE, CSRF, MFA, rate limits, revoked or mismatched membership, cookie propagation, unavailable OTP and actual protected runtime assets. Integrated CI retains frozen source/media identity checks, real Workers/SQLite/HTTP checks and schema/backup verification.

Before replacing Access, prove a real Google callback and owner MFA/CMS access, deploy the fixed Supabase mode and verify anonymous API denial and local login redirection. Keep the existing Access gate until that acceptance. The application migration adds only an identity pin and transient rate table. CMS backups include the pin but exclude rate counters and managed-provider users, passwords, factors and credentials. Verify a fresh encrypted off-server recovery after linking the identity. Managed-provider account recovery and MFA recovery are separate operational gates.
