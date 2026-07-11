---
title: Athena walkthrough abuse budget
status: prelaunch-input-required
owner: product-and-sales-owner
review_after: first-seven-days-of-production-traffic
---

# Athena walkthrough abuse budget

The implementation ships conservative defaults only to make local and QA behavior testable. Production limits are not approved until this report is completed from expected campaign traffic and the configured MailerSend account.

| Input | Prelaunch value | Owner evidence |
|---|---:|---|
| Normal requests per hour | TBD | Launch forecast |
| Campaign peak requests per hour | TBD | Campaign plan |
| Required peak headroom | TBD | Load-test result |
| MailerSend send limit per hour/day | TBD | Provider account limits |
| Maximum acceptable notification cost | TBD | Accountable owner approval |
| Acceptable legitimate rejection risk | TBD | Product owner approval |

Derive `WALKTHROUGH_HOURLY_GLOBAL_LIMIT`, `WALKTHROUGH_DAILY_PER_EMAIL_LIMIT`, `WALKTHROUGH_HOURLY_NOTIFICATION_LIMIT`, and the anonymous analytics drop ceiling `LANDING_FUNNEL_HOURLY_LIMIT` from those inputs. All configured limits must be positive integers in the code-enforced range; malformed values fail closed rather than disabling the bound. Load-test campaign peak plus approved headroom before production. A notification ceiling never rejects a durably stored request; it leaves the attempt pending for authorized processing. A persistence ceiling returns a generic recoverable unavailable response. Funnel events over their ceiling are generically accepted and dropped because analytics must not create a user-facing failure. Equivalent content under per-email pressure remains non-enumerating.

Operational signals are counter pressure, pending-notification age, and provider rejection/timeout rates. Review thresholds after seven days of real traffic. Repeated global exhaustion triggers a scoped bot-challenge design (for example Turnstile); origin, honeypot, and budgets are not represented as protection from distributed automation.

Emergency controls are `WALKTHROUGH_INGRESS_DISABLED=true`, `WALKTHROUGH_NOTIFICATIONS_DISABLED=true`, and `LANDING_FUNNEL_INGRESS_DISABLED=true`. Changes require an incident reference, accountable owner, expiry/review time, and verification in the restricted deployment audit log.
