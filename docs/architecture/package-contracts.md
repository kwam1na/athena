# Package contract boundary

Athena is a Bun workspace with three packages:

| Package | Directory | Role |
| --- | --- | --- |
| `@athena/webapp` | `packages/athena-webapp` | Admin and POS application, plus the Convex backend and its generated data model |
| `@athena/storefront-webapp` | `packages/storefront-webapp` | Customer-facing storefront |
| `@athena/contracts` | `packages/athena-contracts` | The neutral contract surface the other two share |

## The rule

**Application packages do not compile through each other's roots.**

The storefront used to import shared DTOs from `@athena/webapp` — the admin
application root, whose `index.ts` re-exports `types.ts`, which in turn pulls in
`convex/_generated/dataModel` and a Convex schema module. One storefront file
also reached into `../../../athena-webapp/convex/_generated/dataModel` by
relative path. Both meant a browser package compiled through another
application's root and through generated output it does not own.

Shared contracts now live in `@athena/contracts`. It is the only package
permitted to reference `packages/athena-webapp/convex/**`, and it does so from a
single type-only module, `convexModel.ts`.

```
@athena/storefront-webapp ─┐
                           ├─> @athena/contracts ─(type-only)─> athena-webapp/convex/_generated
@athena/webapp ────────────┘        (via packages/athena-webapp/types.ts, a facade)
```

`packages/athena-webapp/types.ts` is kept as a facade that re-exports
`@athena/contracts`, following the repo's facade-preserving module split
pattern, so the ~200 Athena call sites importing `~/types` are untouched and the
Convex bundler keeps resolving the same relative graph it already resolved.

## Enforcement

`bun run architecture:check` fails the build if any file under
`packages/storefront-webapp/src` imports `@athena/webapp`, an `@athena/webapp/*`
subpath, or reaches into `athena-webapp` by relative path. The rule lives in
`scripts/eslint/architecture-boundaries.mjs` as `storefront-package-boundaries`.

## Ownership and how to add a contract

See [`packages/athena-contracts/README.md`](../../packages/athena-contracts/README.md).
