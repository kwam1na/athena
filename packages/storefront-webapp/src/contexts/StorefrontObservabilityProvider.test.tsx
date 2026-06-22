import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  pathname: "/shop",
  search: { origin: "homepage", utm_source: undefined as string | undefined },
}));

const trackStorefrontContextEvent = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: routeState.pathname } }),
  useSearch: () => routeState.search,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ userId: undefined, guestId: "guest_1" }),
}));

vi.mock("@/lib/storefrontContextEvents", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storefrontContextEvents")>(
    "@/lib/storefrontContextEvents",
  );

  return {
    ...actual,
    trackStorefrontContextEvent,
  };
});

import { StorefrontObservabilityProvider } from "./StorefrontObservabilityProvider";

describe("StorefrontObservabilityProvider", () => {
  beforeEach(() => {
    trackStorefrontContextEvent.mockReset();
    routeState.pathname = "/shop";
    window.sessionStorage.clear();
  });

  it("emits one route-view context event per session and route", async () => {
    const rendered = render(
      <StorefrontObservabilityProvider>
        <div>storefront</div>
      </StorefrontObservabilityProvider>,
    );

    await waitFor(() => expect(trackStorefrontContextEvent).toHaveBeenCalledOnce());
    expect(trackStorefrontContextEvent.mock.calls[0]?.[0]).toMatchObject({
      eventInput: {
        eventId: "storefront.route_viewed",
        payload: { route: "/shop" },
      },
      baseContext: {
        route: "/shop",
        userType: "guest",
      },
    });

    rendered.rerender(
      <StorefrontObservabilityProvider>
        <div>storefront</div>
      </StorefrontObservabilityProvider>,
    );

    await waitFor(() => expect(trackStorefrontContextEvent).toHaveBeenCalledOnce());
  });
});
