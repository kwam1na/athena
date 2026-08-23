# `@athena/contracts`

The package-neutral contract surface shared by `@athena/webapp` (admin, POS,
Convex backend) and `@athena/storefront-webapp`.

Before this package existed, the storefront imported shared DTOs from
`@athena/webapp` — the admin application root — and, in one place, from a
relative path into `packages/athena-webapp/convex/_generated/`. That meant the
storefront compiled through another application's root and through generated
Convex output it does not own.

## What lives here

| Module | Owns | Convex dependency |
| --- | --- | --- |
| `convexModel.ts` | `Doc`, `Id`, `Address` | **Yes** — the only sanctioned seam |
| `models.ts` | Document-backed DTOs: catalog, bag, checkout, orders, promo codes, reviews, storefront users, staff, POS | Through `./convexModel` only |
| `storeConfig.ts` | Structural store configuration contracts (`StoreConfigV2` and its parts, `STORE_MTN_MOMO_SETUP_STATUSES`) | None |
| `intelligence.ts` | Re-export of the browser-safe intelligence context-tracking contract | None |
| `homepageRanking.ts` | Re-export of the browser-safe homepage ranking helpers | None |

## Ownership rules

1. **`convexModel.ts` is the only file allowed to reference
   `packages/athena-webapp/convex/**`.** Everything else imports `Doc`/`Id` from
   `./convexModel`. Regenerating the Convex data model therefore never rewrites
   import paths outside the Athena webapp package.
2. **The seam is type-only.** `convexModel.ts` uses `import type` exclusively, so
   it contributes no runtime code to a browser bundle and no schema module ends
   up in the storefront's dependency graph.
3. **No runtime behavior lives here that a consumer could not also compute.**
   This package is contracts plus browser-safe re-exports. Domain logic stays in
   its owning package.
4. **`@athena/storefront-webapp` must not import `@athena/webapp`.** This is
   enforced by `bun run architecture:check` (see
   `scripts/eslint/architecture-boundaries.mjs`).
5. **`packages/athena-webapp/types.ts` is a facade.** It re-exports this package
   so the ~200 Athena call sites that import `~/types` keep working unchanged,
   following the repo's facade-preserving module split pattern. Add new shared
   contracts here, not there.

## Adding a contract

- Structural and Convex-free? Put it in `storeConfig.ts` or a new sibling module
  and export it from `index.ts`.
- Backed by a Convex document? Put it in `models.ts` and derive it from
  `Doc<"table">` imported from `./convexModel`.
- Needed by the storefront but implemented in `packages/athena-webapp/shared/`?
  Add a thin re-export module here and a matching entry in the package's
  `exports` map, so consumers import `@athena/contracts/<name>`.

## Consumers

- `@athena/storefront-webapp` — via the `@athena/contracts` and
  `@athena/contracts/*` tsconfig path mappings, and via the workspace symlink at
  bundle time.
- `@athena/webapp` — via `packages/athena-webapp/types.ts`, which re-exports this
  package with a relative specifier so the Convex bundler resolves it the same
  way it already resolves `types.ts` itself.
