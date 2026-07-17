import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  createFileRoute: vi.fn(() => (options: unknown) => options),
  AppEntryRoute: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: mocked.createFileRoute,
}));

vi.mock("./-app-entry-route", () => ({
  AppEntryRoute: mocked.AppEntryRoute,
}));

import { Route } from "./index";

describe("index route", () => {
  it("uses the authenticated app entry at the root path", () => {
    expect(Route).toMatchObject({ component: mocked.AppEntryRoute });
  });
});
