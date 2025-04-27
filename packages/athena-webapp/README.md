# webapp

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.1.29. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

## LLM Providers

The codebase supports multiple LLM providers.

- **OpenAI**: Uses the OpenAI SDK, see `/convex/llm/providers/openai.ts`.
- **Anthropic**: Uses the Anthropic SDK, see `/convex/llm/providers/anthropic.ts`.

To use Anthropic, set the `ANTHROPIC_API_KEY` [or pass your key explicitly to the provider].

See `/convex/llm/callLlmProvider.ts` for usage and wiring.
