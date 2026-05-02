# Athena Valkey Proxy Loopback Binding On VPS

## Problem

The Valkey proxy exposes cache read, write, and invalidation endpoints. On the production VPS it was listening on `0.0.0.0:3000`, which made the service reachable through the public VPS interface in addition to the intended Cloudflare Tunnel route.

## Fix

Bind the proxy to `127.0.0.1` by default and use Cloudflare Tunnel ingress for the public `cache.wigclub.store` route:

```yaml
- hostname: cache.wigclub.store
  service: http://localhost:3000
```

Keep local standalone Valkey as the VPS default. Only set `VALKEY_CLUSTER=true` when the target cache is actually a Redis-compatible cluster.

## Validation

After deploying the proxy, verify:

```bash
ss -tulpn | grep ':3000'
curl -sS http://127.0.0.1:3000/health
curl -sS --max-time 3 http://<vps-public-ip>:3000/
```

Expected results:

- `ss` shows Node bound to `127.0.0.1:3000`.
- localhost `/health` returns `{"status":"healthy"}`.
- the public VPS IP on `:3000` refuses or times out.

## Lessons

- Binding is the first line of defense for machine-local service endpoints; do not rely on provider-specific firewall defaults.
- A hardening deploy must preserve the live cache topology. For this VPS setup, that means standalone local Valkey unless cluster mode is explicitly enabled.
- Provisioning docs should describe the portable VPS contract, with provider-specific details treated as current-instance facts rather than architecture.
