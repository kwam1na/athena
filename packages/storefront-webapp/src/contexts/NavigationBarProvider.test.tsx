import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  NavigationBarStateProvider,
  deriveShellRouteState,
  useNavigationBarContext,
} from "./NavigationBarProvider";

function Probe() {
  const shell = useNavigationBarContext();
  return (
    <>
      <output data-testid="route">{shell.routeState.location}</output>
      <output data-testid="overlay">{shell.activeOverlay ?? "none"}</output>
      <button
        onClick={(event) =>
          shell.openOverlay("mobile-menu", event.currentTarget)
        }
      >
        Open
      </button>
      <button onClick={() => shell.closeOverlay()}>Close</button>
    </>
  );
}
describe("navigation shell state", () => {
  afterEach(cleanup);
  it("derives route presentation before render", () => {
    expect(deriveShellRouteState("/").layout).toBe("overlay");
    expect(deriveShellRouteState("/shop/bag").location).toBe("shop");
    expect(deriveShellRouteState("/shop/checkout/demo").location).toBe(
      "checkout",
    );
    expect(
      deriveShellRouteState("/shop/receipt/s/demo").navigationVisible,
    ).toBe(false);
  });
  it("locks scroll and restores focus for mobile overlays", () => {
    render(
      <NavigationBarStateProvider pathname="/shop">
        <Probe />
      </NavigationBarStateProvider>,
    );
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.body.style.overflow).toBe("");
    expect(opener).toHaveFocus();
  });
});
