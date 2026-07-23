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

import { Route } from "./app";

type RouteWithHead = {
  head: () => { meta: Array<{ title: string }> };
};

describe("app route metadata", () => {
  it("sets the app title for the legacy app entry path", () => {
    expect(Route).toMatchObject({
      component: mocked.AppEntryRoute,
      head: expect.any(Function),
    });

    expect((Route as unknown as RouteWithHead).head()).toEqual({
      meta: [{ title: "Athena" }],
    });
  });
});
