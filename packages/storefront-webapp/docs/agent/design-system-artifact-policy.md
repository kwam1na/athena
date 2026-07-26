# Design-System Artifact Policy

This policy applies to Storybook fixtures and retained browser screenshots, videos, traces,
network captures, accessibility reports, and visual baselines created during storefront
normalization.

## Synthetic fixtures

Use synthetic fixtures by default. Names, email addresses, phone numbers, postal addresses,
customer IDs, order IDs, receipt numbers, checkout sessions, payment references, product
reviews, and loyalty balances must be invented and visibly non-production. Do not copy a
production response and edit only its obvious fields.

Never include passwords, one-time codes, authorization headers, cookies, API keys, card data,
payment tokens, session tokens, receipt access tokens, or signed URLs. Browser storage and
network bodies must be cleared or replaced with purpose-built synthetic state before capture.

## Redaction

When a flow cannot yet run from a synthetic fixture, redact before retention:

- Replace dynamic customer, order, receipt, checkout, authentication, and payment identifiers
  with stable placeholders such as `customer_demo_001`.
- Remove query parameters and fragments containing tokens or external payment references.
- Mask contact and address fields completely; partial masking is not sufficient for source
  artifacts.
- Inspect screenshots, video frames, traces, console output, network logs, filenames, and
  metadata. Redacting only the visible page is insufficient.

If safe redaction cannot be verified, do not commit, upload, or retain the artifact.

## Access

Committed artifacts are readable by everyone with repository access, so they must contain only
synthetic or verified-redacted data. Local uncommitted captures remain limited to contributors
working on the ticket. Do not place design-system evidence in public buckets, public issue
attachments, or unauthenticated preview links.

## Deployment

Storybook and review builds are internal engineering tools. Deploy only to repository-approved,
access-controlled preview infrastructure. They must not share production cookies, production
environment variables, production service credentials, or live payment configuration.
Publishing Storybook as a public customer surface requires a separate security and product
decision.

## Retention

- Commit small deterministic fixtures and baselines only when they provide durable regression
  value and satisfy this policy.
- Keep CI-generated screenshots, videos, and traces for the CI provider's configured retention
  window; do not duplicate them into long-lived storage by default.
- Delete local exploratory captures after the acceptance evidence is selected.
- Review retained design-system evidence when its route or fixture is retired, and remove
  obsolete artifacts in the same change when practical.

Any suspected sensitive-data capture is an incident: stop sharing the artifact, remove access,
rotate exposed secrets or tokens through the owning system, and follow the repository's
security response path.
