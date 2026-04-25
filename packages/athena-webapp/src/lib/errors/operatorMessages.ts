const OPERATOR_MESSAGE_REWRITES: Array<[RegExp, string]> = [
  [
    /^Invalid staff credentials\.?$/i,
    "Sign-in details not recognized. Enter the username and PIN again.",
  ],
  [
    /^This staff (member|profile) has an active session on another terminal\.?$/i,
    "Register sign-in already active at another register. Sign out there before starting here.",
  ],
  [
    /^A register session is already open for this terminal\.?$/i,
    "Drawer already open for this register. Return to the active sale or review it in Cash Controls.",
  ],
  [
    /^A register session is already open for this register number\.?$/i,
    "Drawer already open for this register number. Review it in Cash Controls before opening another drawer.",
  ],
  [
    /^Open the cash drawer before starting a sale\.?$/i,
    "Drawer closed. Open the drawer before starting a sale.",
  ],
  [
    /^Open the cash drawer before resuming this sale\.?$/i,
    "Drawer closed. Open the drawer before resuming this sale.",
  ],
  [
    /^Open the cash drawer before recovering this sale\.?$/i,
    "Drawer closed. Open the drawer before continuing this sale.",
  ],
  [
    /^Open the cash drawer before modifying this sale\.?$/i,
    "Drawer closed. Open the drawer before updating this sale.",
  ],
  [
    /^Open the cash drawer before completing this sale\.?$/i,
    "Drawer closed. Open the drawer before completing this sale.",
  ],
  [
    /^This sale is already assigned to a different cash drawer\.?$/i,
    "Sale assigned to a different drawer. Open that drawer before continuing.",
  ],
];

export function toOperatorMessage(message: string): string {
  const normalized = message.trim();
  if (!normalized) {
    return normalized;
  }

  for (const [pattern, replacement] of OPERATOR_MESSAGE_REWRITES) {
    if (pattern.test(normalized)) {
      return replacement;
    }
  }

  return normalized;
}
