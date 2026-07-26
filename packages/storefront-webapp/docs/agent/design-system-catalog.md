# Storefront design-system catalog

This catalog is the authority for what code under `src/components/ui` means.
The machine-readable inventory lives in
[`design-system-catalog.json`](./design-system-catalog.json) and is checked by
`src/design-system-build-config.test.ts`.

## Maturity

- **Supported** components have contract tests, a Storybook specimen, and no
  route, API, query, telemetry, context, or feature-state dependency. Prefer
  these for new work.
- **Experimental** components are live building blocks whose API or
  accessibility contract has not yet earned support status. Reuse is allowed
  inside an existing journey, but promote them with tests and a specimen before
  making them a new cross-journey dependency.
- **Feature-specific** files remain live but are not design-system primitives.
  Do not add new consumers. Move them to their journey owner when that journey
  next changes.
- **Deprecated** files are compatibility surfaces with live consumers. Do not
  use them in new code; migrate consumers to the supported replacement.
- **Removable** must stay empty after cleanup. A file may enter this category
  only with repository-search evidence showing no imports, stories, or runtime
  consumers, and it should be deleted in the same cleanup change.

## Supported surface

| Contract | Files | Proof |
|---|---|---|
| Actions | `button`, `icon-button`, `loading-button` | `Primitives/Supported Catalog`; `primitives.test.tsx` |
| Fields | `field`, `input` | `Primitives/Supported Catalog`; `primitives.test.tsx` |
| Feedback | `inline-alert`, `status-badge` | `Primitives/Supported Catalog`; `primitives.test.tsx` |
| Media | `storefront-image` | `Primitives/Supported Catalog`; `primitives.test.tsx` |
| Overlays | `dialog`, `sheet` | `Primitives/Supported Catalog`; `overlay-contract.test.tsx` |

`modal.tsx` is a deprecated compatibility adapter over the supported dialog
contract. `image-with-fallback.tsx`, `ScrollDownButton.tsx`, and the shared
review/promotion animation and type files under `ui/modals` are
feature-specific legacy locations, not reusable primitives. The live welcome
back flow is owned by `components/shopping-bag/promotion`.

## Cleanup evidence

The July 2026 cleanup removed copied primitives, dashboard skeletons, isolated
image-upload/context-menu code, unused upsell modal code, and the unreferenced
Martel font family. Each deleted source path had zero imports outside its own
dead island when searched across `packages/storefront-webapp/src`; the package
build and TypeScript resolver are the backstop for hidden consumers.

The `accent2`–`accent5` Tailwind aliases remain deprecated because repository
search still finds live consumers. Their presence is not support for new use.
Remove each alias only after its source and Storybook usage reaches zero and the
foundation test is updated in the same change.
