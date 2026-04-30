# Product Copy Tone

## Scope

This guide defines Athena's in-product copy tone. Use it for UI labels, toasts, dialogs, empty states, blocking states, confirmations, and operator guidance.

This first version is written broadly for the product, but the first implementation pass is the POS session flow. Do not treat it as marketing voice guidance.

## Voice

Athena product copy should be:

- Calm
- Clear
- Restrained
- Operational

The product should sound composed under pressure. Copy should help someone keep moving, not react emotionally on their behalf.

## Core Rules

- Lead with the system state when something is blocked.
- Use plain language before internal terminology.
- Name the next action when the system knows it.
- Keep one voice across success, warning, and error states.
- Keep toasts short. Use fuller guidance only in blocking or recovery surfaces.
- Normalize awkward backend wording before it reaches operators.
- Do not dramatize failures.
- Do not add cheerleading or brand flourish to routine operations.

## Message Shape

### Toasts

Use one or two short sentences.

Pattern:

- State.
- Action, when needed.

Examples:

- `Drawer closed. Open the drawer before updating this sale.`
- `Barcode not found. Scan again or search by name.`
- `Sale resumed.`

### Inline and Blocking States

Use slightly fuller copy when the screen is already blocked and the operator needs orientation.

Pattern:

- State headline
- Short explanation
- Direct action

Examples:

- `Drawer closed`
- `Front Counter needs an open drawer before this sale can continue.`
- `Open the drawer to continue.`

### Confirmations

Keep confirmation copy compact and factual.

Pattern:

- Completed state.

Examples:

- `Sale started.`
- `Sale placed on hold.`
- `Drawer open. You can start selling.`

## Preferred Patterns

- `Register sign-in required. Sign in before adding items.`
- `Sale assigned to a different drawer. Open that drawer before continuing.`
- `Opening float required. Enter an amount greater than 0.`
- `Sign-in details not recognized. Enter the username and PIN again.`

## Avoid

- `Please enter your username`
- `Payment successful!!!`
- `Something went wrong with the cashier session`
- `A register session is already open for this terminal.`
- `The transaction has been processed and approved.`

## Rewrite Examples

| Avoid                                                          | Prefer                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `Invalid staff credentials.`                                   | `Sign-in details not recognized. Enter the username and PIN again.`                         |
| `This staff member has an active session on another terminal.` | `Register sign-in already active at another register. Sign out there before starting here.` |
| `Open the cash drawer before modifying this sale.`             | `Drawer closed. Open the drawer before updating this sale.`                                 |
| `No active session to hold`                                    | `No sale in progress. Start a sale before placing it on hold.`                              |
| `Transaction completed: TXN-0001`                              | `Sale completed. Transaction TXN-0001 recorded.`                                            |

## Implementation Notes

- Expected command failures may originate from server-side business rules, but the browser must normalize operator-facing copy before display.
- Unexpected failures should still collapse to the shared generic fallback.
- If a message already fits this guide, it can pass through unchanged.

## POS Pilot Boundary

The POS session flow is the first implementation slice for this guide. That includes cashier sign-in, drawer gating, session controls, product-add failures, checkout completion, and other operator-facing session messaging inside the register workflow.

Future work should extend this guide intentionally to other product areas rather than creating one-off local tone rules.

## Correction Surfaces

Correction copy should preserve trust without implying the original sale disappeared. Lead with what Athena can safely change, then name the path for anything that affects ledger, inventory, or completed-sale facts.

Preferred patterns:

- `Opening float corrected.`
- `Opening float can only be corrected while the drawer is open.`
- `Completed sale totals stay locked.`
- `Customer attribution corrected.`
- `Payment method corrected.`
- `Use refund, exchange, or manager review for item, amount, total, or discount corrections.`

Avoid:

- `Edit transaction`
- `Fix the mistake`
- `Override sale total`
- `Force update payment`

When a correction is blocked, explain the state and the next path. Do not expose raw exception text or suggest a direct edit when the safe path is an audited correction event, approval request, refund, exchange, or future workflow.
