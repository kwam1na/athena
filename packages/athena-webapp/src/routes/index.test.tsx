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

type RouteWithHead = {
  head: () => { meta: Array<{ title: string }> };
};

describe("index route", () => {
  it("uses the authenticated app entry at the root path", () => {
    expect(Route).toMatchObject({ component: mocked.AppEntryRoute });
  });

  it("sets the app title at the authenticated-aware root path", () => {
    expect((Route as unknown as RouteWithHead).head()).toEqual({
      meta: [{ title: "Athena" }],
    });
  });
});
