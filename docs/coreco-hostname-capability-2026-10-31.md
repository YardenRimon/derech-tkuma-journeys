# Coreco hostname — capability readback, 31 October 2026

Status: **no verified DNS target; no change authorized or performed here**. Candidate: `derech.coreco.co.il`. Current working review remains `https://derech-tkuma-review.22yarden22.workers.dev/`.

## Observed versus reported

- Direct read-only Cloudflare API at 21:49 UTC: account Workers custom-domain list accepted and empty. The zone list visible to the existing token does not include `coreco.co.il`; visibility is token-scoped, not proof of the absence of every account asset.
- SaaS fallback/custom-hostname reads on the visible active zone returned HTTP403. Thus enablement, fallback origin and a validated candidate hostname are **unverified**, not proven absent. That zone belongs to another project and was not repurposed.
- Coreco coordination reports registrar access is now available at InterNIC, existing public DNS remains SitesDepot, and no records were changed. Registrar access removes an access gate, not the hosting/TLS gate. The website session did not operate InterNIC.
- No hostname registration, account upgrade, subscription, certificate request, DNS change or provider write was made.

## Supported patterns and current gap

[Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) requires an active Cloudflare zone. That standard attachment is not a generic external-DNS CNAME/TXT onboarding mechanism. The current review validator accepts only the known workers.dev review origin; a new hostname also needs a separately reviewed origin/auth configuration.

[Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/) supports external customer hostnames through a provider zone, fallback routing and hostname/certificate validation. A provider must first configure the service and return the exact hostname validation and certificate-validation records. Both validation stages must complete. This is an alternative to moving the customer's DNS ownership; it is **not configured or verified by this readback**.

Do not invent `CNAME derech -> <current workers.dev hostname>`, an IP address, or TXT values. No such target or validation record has been returned by a supported hosting setup. Do not copy an example address from provider documentation into real DNS.

## Handoff to the DNS operator

There are no exact records ready to apply. Before any DNS write, the hosting owner must provide one accepted path:

1. An authorized active Cloudflare zone and Workers attachment compatible with the intended hostname; or
2. An authorized SaaS provider hostname setup (or another existing host supporting external custom domains), with exact CNAME target, ownership/DCV records, service binding and current TLS statuses.

Then verify only that candidate hostname, preserve existing apex/www/MX/SPF/DKIM/DMARC and provider verification records, and obtain the specific hosting/DNS change authorization. A zone/nameserver move is a separate broad change; it is not implied by selecting a custom domain.

Before Coreco review use: host-only CMS cookies, exact Supabase site/redirect origin, existing Google callback behavior, no wildcard auth cookie, anonymous CMS denial, whole-preview access policy where supported, HTTP+HTML noindex, original canonicals/sitemap and no live business or tracking actions. A new hostname must not become production simply because its TLS works.

**Current usable alternative:** path C in the handoff: keep the original public WordPress site and existing workers.dev review. The review is publicly viewable with noindex and action guards; its CMS is authenticated. Do not label the entire current preview as password-protected.

Evidence: operational `audit/coreco-hostname-capability-2026-10-31.json` and `audit/coreco-hostname-saas-readback-2026-10-31.json`; no credentials or raw API data are included here.
