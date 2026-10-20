# Isolated full-application code rollback rehearsal

This rehearsal is local acceptance for switching application code without resetting current CMS data. It does not prove a live Cloudflare rollback or an identity-provider rollback.

Run `scripts/verify-code-rollback.mjs` only against an owner-only `/private/tmp/derech-full-rollback-*` directory. Prepare two immutable Git archives at the pinned source revisions, populate the 982 frozen public assets from the verified canonical manifest, and build each complete Cloudflare Worker with the same locked dependencies and a separate local Vite cache. Use the review configuration without secrets. Preserve both full `dist/server` application module trees and `dist/client` assets.

Restore the independently downloaded encrypted CMS archive locally using the existing private recovery keys and strict restore helper. The private fixture must include its actual schema, rows, SQLite sequence, owner managed identity pin and recovered media. Never print customer rows, identity IDs, bearer material or key contents. Never connect this fixture to a publicly reachable Worker.

The verifier binds Miniflare only to loopback and uses one isolated persistent D1/R2 pair across current → previous → current code. The only synthetic external response is managed `getUser` for a fabricated session matching the restored owner pin; every other outbound destination is denied. It loads the complete built Worker and application modules, not a replacement request handler.

Acceptance requires all 37 public routes and noindex, all 982 frozen asset hashes, protected owner screens and users permissions, anonymous/header-forgery rejection, restored pins/history/revisions/media, and the same full database digest across both code switches. One synthetic private draft is saved through the actual application API before rollback and must survive both switches without public publication. Transient auth counters stay empty. Evidence distinguishes a successful build, real local Workers runtime execution, synthetic identity transport, and live provider actions.

Private build logs, decrypted material, state and `rollback-proof.json` stay in the private rehearsal directory. Only sanitized acceptance results may be copied into a tracked work-state or release record. Any schema difference, restore mismatch, unexpected outbound request, public binding, or missing complete application artifact fails the rehearsal; do not substitute a stub handler or reset D1 between phases.
