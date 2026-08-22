/**
 * Facade over the package-neutral contract surface.
 *
 * The contracts themselves live in `@athena/contracts`
 * (`packages/athena-contracts`). This file stays in place so the Athena admin,
 * POS, and Convex call sites that import `~/types` (or a relative `../types`)
 * keep resolving unchanged.
 *
 * Add new shared contracts to `packages/athena-contracts`, not here. See
 * `packages/athena-contracts/README.md` for ownership rules.
 *
 * The specifier below is relative on purpose: the Convex bundler already
 * follows `convex/** -> ../types`, and a relative path resolves identically for
 * tsc, Vite, and esbuild without depending on workspace symlinks.
 */
export * from "../athena-contracts/index";
