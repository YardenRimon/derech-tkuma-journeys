# Local acceptance evidence — 2026-10-19

Implementation is local and built; no deployment, provider provisioning, push, account invitation or outgoing client message was performed by this subtask.

- Framework production build: PASS, route set includes public pages, visual page CMS, user administration and typed collections. Worker `dist/server/index.js` SHA-256: `d24c16319a8bfa0cf3868cec3f6397fdd64b8babc2b5cdfcc53f7f7ee177c721`.
- TypeScript: PASS.
- Domain tests: PASS (tenant/site isolation, editor/publisher separation, draft/public separation, conflict, history, restore, draft deletion versus withdrawal, occurrence linkage/validation).
- Actual D1 adapter SQL against SQLite with every migration: PASS (atomic CAS/history, isolated reads/writes/public projection).
- Reused Cloudflare JWT tests: PASS (verified signature, wrong claims/signatures, key rotation/error handling, bounded cache).
- Three page fixtures/source-preserving annotation tests: PASS, 538 text leaves + 515 image leaves; all inline script bodies byte-identical; removing only CMS attributes reconstructs exact original HTML. Forced fixture generation also passes independently of the original directory.
- Loopback HTTP: PASS (anonymous and spoofed identity denial, protected admin UIs, three exact public pages/noindex, private draft preview, conflict 409, publish/rollback, wrong-origin 403, local R2 upload/readback, typed collection CRUD/history and published-only read).
- Admin bootstrap HTTP: PASS (normalized/deduped optional server admin allowlist, admin/editor overlap, outsider/header spoof rejection, correct verified identity binds initially unpinned admin, replacement subject with same email rejected, original remains valid, content editor cannot publish or manage users).
- Schema metadata: `db/schema.ts`, generated 0003/0004 SQL, journal and snapshots 0000–0004 present. `db:generate` reports no schema changes. Inherited 0000–0002 SQL remains byte-identical to Gvanim source. No source identities/data/runtime state were copied.
- All three public templates retain explicit noindex meta and runtime responses add `X-Robots-Tag: noindex, nofollow`. Public collection and media responses also carry noindex. DB/page/public-collection/media reads fail closed without the configured isolated adapter scope. CMS needs a verified identity and bound role.
- Original `__pilot__/guard.js` remains unchanged and linked in all three pages: public demo form/POST/checkout/cart/wp-admin/wp-json/external request/beacon and external-window actions remain disabled. It does not affect protected admin routes, which use the real CMS API.

Public HTML SHA-256 values (also in `source-manifest.json`):

| Page | SHA-256 |
| --- | --- |
| `/` | `f0224c34dea300fea692b4925f0918bf3db055e54a10e72c3b3d1db7926ff80b` |
| `/סיורים/` | `15d0f6964a100480f5b4810094de8c3eb69d617f9753824388c56949603fd5b9` |
| `/maslulim/עוז-מול-תופת/` | `e4e31863bb606c013191c19dd2f276d424f9dfd2a4b55e6430ba6cfa78c92f0d` |

Local preview remains at `http://127.0.0.1:5174/`, synthetic owner `seedy@sites.test`. Retained session: 71619. Owner signs in via `/signin-with-chatgpt?return_to=%2Fadmin`. Extra test identities are enabled only for the current loopback development process; they are absent as an authentication option in production builds.

Remaining gates: browser visual acceptance by the integrating parent, clean dependency installation/CI, Site source packaging/sync and live D1/R2/runtime env provisioning, backup/recovery acceptance, deployment/live readback. Typed records are not yet wired into the preserved static public tour cards. This is an isolated D1/R2 pilot adapter, not the shared Postgres SaaS core; list/history limits and future membership/site-grant adapter remain explicit in README.

Final narrow UI refinement: automatic hidden IDs; human tour/deleted-draft labels; occurrence tour dropdown; fixed Asia/Jerusalem and ILS defaults; shekel price display converted to integer minor units; tour image upload. Explicit-offset date fields retain a clear winter/summer example; automatic DST conversion remains out of scope for this review. Root performs the final build/package after this UI handoff.
