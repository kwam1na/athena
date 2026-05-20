import { beforeEach, describe, expect, it, vi } from "vitest";

const createFileRouteMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: createFileRouteMock,
}));

vi.mock("~/src/components/pos/terminals/POSTerminalHealthView", () => ({
  POSTerminalHealthView: () => null,
}));

vi.mock("~/src/components/pos/terminals/POSTerminalDetailView", () => ({
  POSTerminalDetailView: () => null,
}));

vi.mock("~/src/components/states/not-found/NotFoundView", () => ({
  NotFoundView: () => null,
}));

describe("POS terminal health routes", () => {
  beforeEach(() => {
    vi.resetModules();
    createFileRouteMock.mockReset();
    createFileRouteMock.mockImplementation((routePath: string) => {
      const routeBuilder = (options: Record<string, unknown>) => ({
        options,
        path: routePath,
        useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "osu" }),
      });
      return routeBuilder;
    });
  });

  it("wires the terminal health roster route", async () => {
    await import("./terminals.index");

    expect(createFileRouteMock).toHaveBeenCalledWith(
      "/_authed/$orgUrlSlug/store/$storeUrlSlug/pos/terminals/",
    );
  });

  it("wires the terminal health detail route", async () => {
    await import("./terminals/$terminalId");

    expect(createFileRouteMock).toHaveBeenCalledWith(
      "/_authed/$orgUrlSlug/store/$storeUrlSlug/pos/terminals/$terminalId",
    );
  });
});
