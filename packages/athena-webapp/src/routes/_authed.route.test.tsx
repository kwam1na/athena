import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  createFileRoute: vi.fn(() => (options: unknown) => options),
  AuthenticatedLayout: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: mocked.createFileRoute,
}));

vi.mock("./-authenticated-layout", () => ({
  AuthenticatedLayout: mocked.AuthenticatedLayout,
}));

import { Route } from "./_authed.tsx";

type RouteWithHead = {
  head: () => { meta: Array<{ title: string }> };
};

describe("authenticated route metadata", () => {
  it("sets an app title instead of inheriting the public marketing title", () => {
    expect(Route).toMatchObject({
      component: mocked.AuthenticatedLayout,
      head: expect.any(Function),
    });

    expect((Route as unknown as RouteWithHead).head()).toEqual({
      meta: [{ title: "Athena" }],
    });
  });
});
