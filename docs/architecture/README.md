> Looking for how the workspace packages depend on each other? See
> [package-contracts.md](./package-contracts.md).

# Architecture diagram rendering

Athena owns the semantic source for its architecture diagrams. Visual profiles
change typography and color without duplicating diagram content or geometry.

The standalone HTML pages default to the `athena` light profile. Render the
GitHub-facing PNGs with:

```bash
bun run docs:diagrams
```

Create a portable light-and-dark bundle for `kwamina-fyi` with:

```bash
bun run docs:diagrams --profile kwamina-fyi --bundle ./dist/kwamina-fyi-diagrams
```

The bundle contains paired PNGs and `manifest.json`. The manifest records the
diagram ID, source, profile, theme, dimensions, and SHA-256 hash used by the
receiving repository to verify the assets before publication.

Profiles live in [`diagram-theme.css`](./diagram-theme.css). Diagram SVGs use
the semantic variables defined there for canvas, surfaces, text, rules,
accents, and the display, body, and technical type roles. New diagrams must use
the same variables instead of embedding brand-specific colors or font stacks.

For a one-off themed Athena render, pass `--theme dark`. When `--bundle` is
present and no explicit theme is supplied, both light and dark variants are
exported.
