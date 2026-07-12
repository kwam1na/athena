---
title: Walkthrough request operations
owner: product-and-sales-owner
access: restricted-convex-deployment-operators
---

# Walkthrough request operations

Athena's `walkthroughRequest` table is the system of record. A `202 {"accepted":true}` means the request was durably stored (or safely deduplicated); notification delivery is secondary. There is no public or tenant-admin lead read, retry, lifecycle, aggregate-read, export, or redaction API.

Retry the same submission key only with the same canonical payload; that path remains idempotently accepted without spending fresh-key capacity. When equivalent content arrives under a newly observed key, Athena stores a minimal HMAC replay alias so the accepted key cannot later be reused with changed content. Fresh-key aliases consume the configured per-email and global admission budgets. Once either ceiling is exhausted, another fresh-key equivalent returns generic recoverable `temporarily_unavailable` without persistence; the prospect retains the form and can retry later with the unchanged key. This deliberate bound prevents duplicate suppression from becoming unbounded storage.

Before production, configure an exact production and QA origin allowlist, the owner-approved `WALKTHROUGH_PRIVACY_CONTACT`, one accountable recipient, approved limits from the abuse-budget report, and a distinct environment-specific HMAC key ring. The HTTP ingress remains closed when the privacy contact is absent or invalid. `WALKTHROUGH_ALLOW_LOCAL_ORIGINS=true` is local-development-only and must be absent from QA and production. Keep one active HMAC version plus every prior verification key until all tombstones signed by it have expired. Never paste key material, lead payloads, or provider response bodies into logs or tickets.

The public build has a separate compile-time setting: `VITE_WALKTHROUGH_PRIVACY_CONTACT`. Set it to the same owner-approved address as the Convex runtime `WALKTHROUGH_PRIVACY_CONTACT`; the values must not diverge. Changing the Vite value requires rebuilding and redeploying Athena—it cannot be changed by updating Convex environment variables alone. Leaving it empty intentionally keeps the browser form disabled.

Before opening submissions, verify the deployed `/privacy` page publishes the approved address, `/walkthrough` has an enabled submit action, and a controlled request from an allowed origin reaches durable acceptance. Confirm the Convex runtime uses the same address and that a missing or mismatched launch setting is corrected before accepting production traffic.

## Restricted commands

Run only from the restricted Convex deployment dashboard or authenticated CLI and correlate the asserted `operatorReference` with that platform's access audit record.

- `marketing/walkthroughRequests:listOpen` — bounded open work queue.
- `marketing/walkthroughRequests:resolve` — set `qualified`, `not_qualified`, or `unknown`; include bounded reason and operator references.
- `marketing/walkthroughRequests:abandon` — terminally abandon a request.
- `marketing/walkthroughRequestNotifications:inspectAttempts` — inspect bounded delivery state.
- `marketing/walkthroughRequestNotifications:deliberateRetry` — retry only after reviewing a retryable, terminal, or ambiguous attempt. This appends an operations audit.
- `marketing/walkthroughRequestNotifications:resolveUnknown` — record whether an ambiguous provider outcome was sent or is explicitly eligible for deliberate retry. Never automatically retry a timeout.
- `marketing/walkthroughRequestRetention:beginPrivacyChallenge` — register the SHA-256 digest of a high-entropy one-time challenge for either export or redaction; send the unhashed challenge only to the stored email returned to the restricted operator.
- `marketing/walkthroughRequestRetention:exportVerifiedSubject` — consume a matching reply digest within 24 hours, return the bounded subject export, and append the verified-export audit.
- `marketing/walkthroughRequestRetention:redactVerifiedSubject` — consume a matching redaction challenge, redact the subject, terminate pending notification work, and append the verified-redaction audit.
- `marketing/walkthroughRequestRetention:cleanupBatch` and `marketing/landingFunnelRetention:cleanupBatch` — normally cron-owned; manual invocation is for observed backlog recovery.

## Proof of control for export or deletion

The subject contacts the published privacy address. An operator generates a high-entropy one-time challenge, records only its `sha256:<hex>` digest with `beginPrivacyChallenge`, and sends the unhashed value to the email already stored on the request. A matching reply from that address must arrive within 24 hours. Hash the returned value locally and pass only the digest to the corresponding export or redaction command. Challenges are action-specific, expire after 24 hours, and can be consumed once. If the stored address is unavailable, stop and escalate to a separately approved identity review—do not bypass proof of control. Deliver a returned export only to the verified address. After redaction retain only request id, verification/operator audit, lifecycle outcome, and time-bounded replay-prevention evidence.

## Delivery and recovery

Notification states are `pending`, `in_flight`, `sent`, `retryable_failure`, `terminal_failure`, and `outcome_unknown`. Leases expire after five minutes; a stale in-flight lease becomes `outcome_unknown` for authorized review rather than being resent automatically. Transient provider failures use bounded capped retries. Provider timeouts become `outcome_unknown`, because retrying could send a duplicate. Missing recipient/API configuration is visible as `missing_configuration` while the lead remains durable. The emergency-disable and hourly notification budget are checked atomically when acquiring every delivery lease, including recovery work.

Never include submission keys, digests, budget state, audit metadata, or provider response bodies in MailerSend. The allowlist is request id, name, work email, business name, optional phone, and bounded sanitized business need.

## Retention

- Inactive open requests become abandoned and have PII redacted at 180 days.
- Resolved or abandoned requests have PII redacted 180 days after terminal transition.
- Terminal delivery diagnostics expire after 30 days.
- Submission-key/HMAC tombstones expire after 365 days.
- Anonymous raw funnel events expire after 30 days; daily aggregate buckets expire after 395 days.

The cleanup cron is indexed, bounded, and self-continues while a batch is full. Missing active HMAC configuration fails cleanup observably instead of retaining a predictable plain digest as pseudo-anonymous data.
