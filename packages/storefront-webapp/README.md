# Athena storefront

The customer-facing storefront is a Vite/React app in the Athena monorepo. It
owns its visual language and commerce journeys while following Athena's
design-system governance model.

## Start locally

```bash
bun install
bun run --filter '@athena/storefront-webapp' dev
```

## Design-system consumers

Before changing presentation, read:

- [`docs/agent/design.md`](./docs/agent/design.md) for tokens, composition,
  accessibility, motion, and copy contracts.
- [`docs/agent/design-system-catalog.md`](./docs/agent/design-system-catalog.md)
  for supported, experimental, feature-specific, and deprecated components.
- [`docs/agent/design-system-artifact-policy.md`](./docs/agent/design-system-artifact-policy.md)
  before capturing Storybook or browser evidence.

Start with a supported component. Experimental components need contract tests
and a Storybook specimen before promotion. Feature-specific and deprecated
components must not gain new consumers.

## Validation

```bash
bun run --filter '@athena/storefront-webapp' test
bun run --filter '@athena/storefront-webapp' build
bun run --filter '@athena/storefront-webapp' storybook:build
bun run --filter '@athena/storefront-webapp' lint:design-system:changed
```

Use [`docs/agent/validation-guide.md`](./docs/agent/validation-guide.md) to
select narrower checks for a change.
