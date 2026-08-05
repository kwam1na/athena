import { useEffect, useState } from "react";

import {
  getLocalOperatingDate,
  getLocalOperatingDateRange,
  getOperatingClockNow,
  getOperatingTimezone,
  setOperatingTimezoneOverride,
} from "@/lib/operations/operatingDate";

/**
 * Store-clock plumbing for the shared demo.
 *
 * One demo store is served to visitors in every timezone while its server
 * resolves operating dates in STORE time. These hooks make the browser agree:
 * `useSharedDemoOperatingClock` installs the store's zone as the authority for
 * every `getLocalOperatingDate` call site, and `useStoreOperatingDate` keeps a
 * rendered day label honest across the store's own midnight.
 */

/** Milliseconds from `now` to the start of the next operating day. */
export function msUntilNextOperatingDate(now = getOperatingClockNow()) {
  const remaining = getLocalOperatingDateRange(now).endAt - now.getTime();

  // A clock that has drifted onto or past the boundary must still make
  // progress; rescheduling with a non-positive delay would spin.
  return remaining > 0 ? remaining : 1_000;
}

/**
 * Points every operating-date call site at the demo store's own zone.
 *
 * Applied DURING render rather than in an effect: the demo fixtures derive
 * "today" while rendering, so an effect would let one paint resolve against the
 * browser clock and name a day the store has already closed. The write is
 * idempotent and guarded, so a repeated or double-invoked render is a no-op.
 *
 * Pass `undefined` for a real store — browser-local derivation is correct when
 * the operator is inside the store's own timezone.
 */
export function useSharedDemoOperatingClock(timezone: string | undefined) {
  const next = timezone ?? null;
  if (getOperatingTimezone() !== next) {
    setOperatingTimezoneOverride(next);
  }

  useEffect(() => {
    return () => setOperatingTimezoneOverride(null);
  }, []);
}

/**
 * The operating date in force, re-rendered when the store's midnight passes.
 *
 * A demo left open across the store's rollover would otherwise keep reading the
 * previous day: fixtures are memoised on this label, so it has to change for
 * the history rail and the live day to move together.
 */
export function useStoreOperatingDate() {
  // Read during render so a zone installed by `useSharedDemoOperatingClock` in
  // a parent is already visible here on the same pass.
  const timezone = getOperatingTimezone();
  // The date is DERIVED during render rather than held in state, so mounting
  // this hook costs no extra render — it lands on every Reports surface, and a
  // spurious render there re-opens every subscription those surfaces own. The
  // timer exists only to force a render when the day actually rolls over.
  const [, setRollover] = useState(0);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timeout = setTimeout(() => {
        setRollover((count) => count + 1);
        schedule();
      }, msUntilNextOperatingDate());
    };
    schedule();

    return () => clearTimeout(timeout);
  }, [timezone]);

  return getLocalOperatingDate();
}
