---
title: A Second Admin Origin Is an Alias, Not a Redirect, When the Client Holds State
date: 2026-08-10
category: architecture-patterns
module: Athena admin app / VPS nginx + Cloudflare Tunnel
problem_type: architecture_pattern
component: deployment_infrastructure
resolution_type: config_change
severity: medium
applies_when:
  - "An app is moving to a new hostname and an offline-capable client is bookmarked to the old one"
  - "A hostname-derived config value silently falls back instead of failing when the host is unrecognised"
  - "A domain being repointed already serves a live site through the same CDN"
  - "A dev-server-backed environment gains a hostname the framework does not know about"
related_components:
  - "athena-webapp-config-storefront-url"
  - "vps-nginx-server-blocks"
  - "cloudflare-tunnel-ingress"
  - "convex-email-deep-links"
tags:
  - origin-scoped-state
  - dual-host-serving
  - silent-config-fallback
  - cloudflare-tunnel
  - vite-allowed-hosts
delivery_diff_fingerprint: abf7d4500c98b31fb79177a925049209a5a8f98a1cc8e1c29e4a6abb4c297d03
---

# A Second Admin Origin Is an Alias, Not a Redirect, When the Client Holds State

## Problem

The admin app moved from `athena.wigclub.store` to `athena-os.app`. The obvious
implementation — repoint DNS and 301 the old host at the new one — would have
destroyed data.

The production POS terminal is bookmarked to the legacy host and is offline-capable.
Its unsynced sales live in an `athena-pos-local` IndexedDB, its shell in a service
worker cache, its session in `localStorage` — all three are **origin-scoped**. A
redirect moves the browser to an origin where none of that exists, and the old origin
becomes unreachable, so any sale not yet synced is stranded with no path back.

Three smaller traps sat alongside it:

- `resolveStoreFrontUrl` derived the storefront hostname from the admin hostname by
  string transform (`athena.X` → `X`). `athena-os.app` matches no branch and fell
  through to `http://localhost:5174` — silently. Production was masked only because
  the deploy passes `VITE_STOREFRONT_URL`; nothing said so, and QA did not pass it.
- The target domain was already serving a live Squarespace site through the same
  Cloudflare zone, so this was a repoint of a working site, not an empty-zone setup.
- Adding a hostname to the QA environment is not an infrastructure-only change: Vite's
  dev server rejects unknown `Host` headers with a 403.

## Solution

**Serve both origins from one document root. Never redirect the legacy host.**
`server_name athena-os.app athena.wigclub.store;` on a single nginx block, with
`ATHENA_LEGACY_HOST` as a named variable carrying a comment explaining why it is not a
redirect, so a later reader does not "simplify" it. The legacy host is retired only
after the terminal has drained to zero unsynced events and been re-onboarded.

**Make the environment variable authoritative and the fallback loud.** The hostname
transform is kept for the legacy `athena*.wigclub.store` hosts, where it is genuinely
mechanical, and factored into a named helper. Any unrecognised deployed host now warns
that `VITE_STOREFRONT_URL` is missing instead of silently pointing every storefront
link at a dev server. No `athena-os.app → wigclub.store` mapping was added: that would
hardcode tenant identity into the platform host.

**Everything a rename touches must be enumerated, not assumed.** The primary-host
change reached four Convex email builders, the static `index.html` metadata, the
Playwright prod default, the rollback smoke check (which now loops over both hosts —
a rollback leaving either broken is a failed rollback), and the screen-redact
extension's origin list.

## Prevention

- **Ask what the client stores before choosing redirect vs alias.** The question is not
  "is the old URL still needed" but "does anything at that origin hold state the user
  cannot re-create". IndexedDB, service worker caches, and sessions all answer yes.
- **A config fallback that cannot be right should say so.** A `localhost` default
  reached from a production hostname is not a fallback, it is a silent failure. Warn.
- **`cfargotunnel.com` CNAMEs must be Proxied.** A DNS-only record does not resolve
  publicly at all. This is the most common way the setup fails and the symptom
  (NXDOMAIN-ish) does not point at the cause.
- **Check for an HTTPS/SVCB record when repointing a proxied domain.** One carrying an
  `ipv4hint` at the old origin will send browsers there even after A/CNAME records are
  fixed — `curl` passes, Chrome does not. `cloudflared tunnel route dns` does not touch
  it. In this case the record existed at the registrar but had never been copied into
  Cloudflare.
- **cloudflared has no reload.** `systemctl reload` fails; the unit ships without
  `ExecReload` and there is no supported signal for ingress changes. A restart drops
  every hostname on the tunnel, so on a shared tunnel use the documented replica
  overlap during trading hours.
- **cloudflared parses flags before positionals.** `route dns <id> <host>
  --overwrite-dns` reads the flag as a third positional and fails with a confusing
  argument-count error. Flags go first.
- **A new QA hostname needs `server.allowedHosts` in `vite.config.ts`** and, where the
  storefront URL is not derivable from it, an explicit `VITE_STOREFRONT_URL` in the
  deploy path.

## Evidence

Verified externally after the cutover: `athena-os.app` returns 200 serving the admin
app with no Squarespace markers (`crumb` cookie, `x-contextid` header both absent),
`www.athena-os.app` returns 301 to the apex, and `athena.wigclub.store` still returns
200 for the POS terminal. `qa.athena-os.app` returns 403 from Vite until the
`allowedHosts` change deploys — that 403 is itself proof the
Cloudflare → tunnel → nginx → dev-server path is intact.
