# Design State and Overlay Matrix

This matrix is the authoritative acceptance record for normalized storefront
states and overlays. It complements the route contracts in
[`design-system-migration-baseline.md`](./design-system-migration-baseline.md):
that document owns business and navigation compatibility; this document owns
presentation, focus, dismissal, motion, and customer-feedback behavior.

## State contract

| State | Authoritative pattern | Customer-visible contract | Accessibility and motion proof |
| --- | --- | --- | --- |
| Initial loading | `PageState` loading variant or a stable, labeled skeleton | Existing layout space remains stable; primary content is never represented by a blank page | Busy state is programmatically exposed; no essential information depends on animation |
| Empty | `PageState` empty variant | Names what is empty and provides the next useful action when one exists | Heading and action remain in reading order and keyboard reachable |
| Recoverable error | `PageState` error variant or field error composition | Explains what is safe, what failed, and how to retry without exposing backend wording | Error is associated with the affected control or announced as status; retry preserves safe input |
| Terminal error | Route error boundary using `PageState` | States that the journey cannot continue and offers a safe destination | Focus reaches the error heading/action; no automatic redirect hides the error |
| Disabled or busy | Supported action and form primitives | Prevents repeat submission while preserving the action name and progress meaning | Native disabled/`aria-disabled` and `aria-busy` semantics match actual activation behavior |
| Success | Inline status, toast, or route success template according to persistence | Claims success only after the feature contract confirms it | Status is announced once; feedback does not steal focus or rely on color alone |
| Reduced motion | Shared `getRevealMotion` contract and global CSS policy | Content is visible immediately with no translated starting position or delayed navigation | Delay and duration are zero; equivalent content and actions remain available |

## Overlay contract

| Surface | Owner | Initial focus | Escape / outside dismissal | Focus restoration | Navigation and teardown |
| --- | --- | --- | --- | --- | --- |
| Desktop category menu | Navigation shell | First “Shop all” link; overlay boundary only if no action exists | Escape closes and restores; pointer leave closes without forcing focus | Returns to the category trigger when explicitly dismissed | Link activation closes without restoration; pathname change clears shell state |
| Desktop bag/account menu | Navigation shell | First enabled link or button | Escape closes and restores; pointer leave closes without forcing focus | Returns to the bag trigger when explicitly dismissed | Destination activation closes without restoration; pathname change clears shell state |
| Mobile category menu | Supported `Sheet` | Radix close control, then sheet content in DOM order | Escape, close control, and outside interaction follow `Sheet` | Radix restores the menu trigger | Link activation closes; pathname change clears shell state and scroll lock |
| Mobile bag/account menu | Supported `Sheet` | Radix close control, then title/content | Escape, close control, and outside interaction follow `Sheet` | Radix restores the bag trigger | Link activation closes; pathname change clears shell state and scroll lock |
| Mobile catalog filters | Supported `Sheet` | Radix close control, then filter controls | Escape, close control, and outside interaction follow `Sheet` | Radix restores the named filter trigger | Apply/navigation closes; teardown releases body scroll lock |
| Dialog and confirmation flows | Supported `Dialog` | Explicit primary content target when needed, otherwise Radix's first focusable control | Escape and outside behavior are declared by the feature; destructive work never runs on dismissal | Radix restores the connected opener | Unmount and route transitions release focus trap and scroll ownership |
| Image/gallery detail | Supported `Dialog` or documented gallery pattern | Close control or selected media control | Escape closes; gestures are optional, never the only dismissal | Returns to the invoking media control | Route teardown removes the overlay without changing gallery selection contracts |

## Automated evidence

- `src/components/ui/overlay-contract.test.tsx` proves the supported Dialog and
  Sheet focus trap, Escape dismissal, and opener restoration contracts.
- `src/contexts/NavigationBarProvider.test.tsx` proves shell scroll locking and
  opener restoration.
- `tests/e2e/storefront-shell.e2e.ts` proves desktop initial focus, Escape,
  restoration, route teardown, responsive fit, and immediate reduced-motion
  shell content in the integrated app.
- `src/lib/motion.test.ts` proves immediate, non-translating reveal values.
- `src/styles/design-system-policy.test.ts` and the whole-tree policy baseline
  prevent new raw-value drift while residual migration debt is reduced.

Any new overlay or state family must be added to this matrix in the same change
as its supported primitive/pattern and automated proof.
