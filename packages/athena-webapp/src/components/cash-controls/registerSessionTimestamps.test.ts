import { describe, expect, it } from "vitest";

import {
  formatRegisterSessionDate,
  formatRegisterSessionDayAndTime,
  formatRegisterSessionTimestamp,
} from "./registerSessionTimestamps";

// 2026-04-29 is a Wednesday; the times are chosen to sit inside the same UTC
// day so the assertions do not depend on the runner's timezone offset.
const MIDDAY = new Date("2026-04-29T12:00:00.000Z").getTime();

describe("register session timestamp formatting", () => {
  it("leads the full timestamp with the weekday", () => {
    expect(formatRegisterSessionTimestamp(MIDDAY)).toMatch(
      /^Wed, Apr 29, 2026, /,
    );
  });

  it("leads the date-only label with the weekday", () => {
    expect(formatRegisterSessionDate(MIDDAY)).toBe("Wed, Apr 29, 2026");
  });

  it("leads the day-and-time label with the weekday and omits the year", () => {
    const formatted = formatRegisterSessionDayAndTime(MIDDAY);

    expect(formatted).toMatch(/^Wed, Apr 29, /);
    expect(formatted).not.toContain("2026");
  });
});
