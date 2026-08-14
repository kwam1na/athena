---
date: 2026-08-13
topic: device-local-sun-cycle-appearance
---

# Device-local sun cycle appearance

## Summary

Add a browser-local appearance mode that uses the device location to render Athena in light mode from sunrise and dark mode from sunset.

---

## Problem Frame

Athena currently supports system, light, and dark appearance preferences. Operators who want the interface to follow available daylight must either change it manually or rely on an operating-system schedule that may not match local sunrise and sunset.

---

## Key Flows

- F1. Enable Sun cycle
  - **Trigger:** An operator selects Sun cycle in App settings.
  - **Steps:** Athena requests browser location access, resolves the current appearance, and communicates the next transition.
  - **Outcome:** The browser follows local sunrise and sunset without a server-side preference.
  - **Covered by:** R1, R2, R3, R4
- F2. Resume after time has passed
  - **Trigger:** Athena reaches a solar boundary or returns from sleep/background use.
  - **Steps:** Athena recalculates the current solar period and applies the appropriate appearance.
  - **Outcome:** The appearance reflects the current local daylight period.
  - **Covered by:** R5, R6

---

## Requirements

- R1. App settings offers Sun cycle alongside System, Light, and Dark.
- R2. Selecting Sun cycle requests device location only at that moment.
- R3. Location data remains browser-local and is stored at coarse precision.
- R4. Athena uses light appearance from local sunrise and dark appearance from local sunset.
- R5. Athena communicates the active appearance and the next solar transition in calm, sentence-case metadata.
- R6. Athena recalculates after a solar transition and when the browser resumes or regains focus.
- R7. If location cannot be obtained, Athena retains the prior appearance and explains how to continue.
- R8. Sun cycle uses the existing saved dark palette when it resolves to dark.
- R9. Automatic solar transitions respect reduced-motion preferences and do not use an attention-grabbing manual transition.

---

## Acceptance Examples

- AE1. **Covers R2, R3, R4.** Given Light is selected, when the operator selects Sun cycle and grants location access during daylight, Athena remains light and stores the coarse location only in that browser.
- AE2. **Covers R4, R5, R6.** Given Sun cycle is active before sunset, when sunset passes, Athena becomes dark and reports sunrise as the next transition.
- AE3. **Covers R7.** Given an explicit appearance is selected, when the operator selects Sun cycle and location access is denied, Athena retains the explicit appearance and shows restrained recovery guidance.

---

## Success Criteria

- Operators can enable a true sunrise-to-sunset appearance schedule without configuring the store or synchronizing a preference to the server.
- The current appearance and upcoming transition remain understandable at a glance.
- Reloading or resuming Athena does not leave the appearance stale.

---

## Scope Boundaries

- No store-level coordinates or location configuration.
- No server persistence or cross-device synchronization.
- No fixed-time approximation of sunrise or sunset.

---

## Key Decisions

- The schedule follows the device location because appearance is a local workspace preference and should match the operator's physical environment.
- Location permission is contextual and opt-in rather than requested during app startup.
- Automatic changes are restrained state updates; manual appearance choices retain their existing transition feedback.
