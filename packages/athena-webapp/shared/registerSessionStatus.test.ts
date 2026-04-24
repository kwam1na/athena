import { describe, expect, it } from "vitest";

import {
  isCashControlVisibleRegisterSessionStatus,
  isPosUsableRegisterSessionStatus,
  isRegisterSessionConflictBlockingStatus,
} from "./registerSessionStatus";

describe("register session status policies", () => {
  it.each([
    ["open", true],
    ["active", true],
    ["closing", false],
    ["closed", false],
  ] as const)("classifies %s POS usability as %s", (status, expected) => {
    expect(isPosUsableRegisterSessionStatus(status)).toBe(expected);
  });

  it.each([
    ["open", true],
    ["active", true],
    ["closing", true],
    ["closed", false],
  ] as const)("classifies %s duplicate-drawer blocking as %s", (status, expected) => {
    expect(isRegisterSessionConflictBlockingStatus(status)).toBe(expected);
  });

  it.each([
    ["open", true],
    ["active", true],
    ["closing", true],
    ["closed", false],
  ] as const)("classifies %s cash-control visibility as %s", (status, expected) => {
    expect(isCashControlVisibleRegisterSessionStatus(status)).toBe(expected);
  });
});
