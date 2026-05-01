# Athena Webapp

The Athena webapp is the owner/operator console for the solo-business OS. It
combines the authenticated React app with the Convex backend that runs the core
business workflows.

## Main Surfaces

- `src/routes`: TanStack Router entrypoints for the authenticated shell,
  organization/store routing, login, and feature routes.
- `src/components`: owner/operator UI for POS, products, orders, cash controls,
  operations, procurement, services, staff, analytics, reviews, and
  configuration.
- `src/lib` and `shared`: browser-safe helpers, presentation state, command
  result handling, money formatting, and shared contracts.
- `convex`: backend functions, schema, HTTP routing, workflow traces, POS,
  stock operations, service operations, cash controls, storefront commerce, and
  integrations.

## Run Locally

Install dependencies from the repo root:

```bash
bun install
```

Start the app:

```bash
bun run --filter '@athena/webapp' dev
```

## Testing

Run the package test suite:

```bash
bun run --filter '@athena/webapp' test
```

For watch mode:

```bash
bun run --filter '@athena/webapp' test:watch
```

Common backend validation:

```bash
bun run --filter '@athena/webapp' audit:convex
bun run --filter '@athena/webapp' lint:convex:changed
```

## LLM Providers

The codebase supports multiple LLM providers.

- **OpenAI**: Uses the OpenAI SDK, see `/convex/llm/providers/openai.ts`.
- **Anthropic**: Uses the Anthropic SDK, see `/convex/llm/providers/anthropic.ts`.

To use Anthropic, set the `ANTHROPIC_API_KEY` [or pass your key explicitly to the provider].

See `/convex/llm/callLlmProvider.ts` for usage and wiring.
