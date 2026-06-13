import { describe, expect, it, vi } from "vitest";

import { applyRemoteAssistControlIntent } from "./applyRemoteAssistControlIntent";
import { captureRemoteAssistCoBrowseFrame } from "./remoteAssistCobrowseRecorder";

describe("remoteAssistCobrowseRecorder", () => {
  it("captures visible text and controls while masking sensitive content", () => {
    document.body.innerHTML = `
      <main>
        <h1>Register checkout</h1>
        <p>Cash total GHS 25</p>
        <input aria-label="Customer phone" type="tel" value="0240000000" />
        <button
          aria-label="Add item"
          data-remote-assist-control="register-add-item"
          data-remote-assist-control-label="Add item"
          data-remote-assist-control-role="button"
        >
          Add item
        </button>
      </main>
    `;
    setElementRect("h1", { height: 32, width: 180, x: 20, y: 4 });
    setElementRect("p", { height: 24, width: 160, x: 20, y: 24 });
    setElementRect("button", { height: 32, width: 100, x: 20, y: 40 });
    setElementRect("input", { height: 32, width: 160, x: 20, y: 80 });

    const frame = captureRemoteAssistCoBrowseFrame({
      document,
      frameId: "frame-1",
      now: 1_000,
      sessionId: "session-1",
      window,
    });

    expect(frame.surface?.visibleText).toContain("Register checkout");
    expect(JSON.stringify(frame.surface)).not.toContain("0240000000");
    expect(JSON.stringify(frame.surface)).not.toContain("Customer phone");
    expect(frame.surface?.controls).toEqual([
      expect.objectContaining({
        controlId: "register-add-item",
        label: "Add item",
        role: "button",
      }),
    ]);
    expect(frame.redaction.sensitiveRegionCount).toBe(1);
  });

  it("only exposes controls explicitly marked with Remote Assist data attributes", () => {
    document.body.innerHTML = `
      <main>
        <button aria-label="Global shell action">Global shell action</button>
        <a href="/pos/register" data-remote-assist-control="pos-register" data-remote-assist-control-label="Open register">POS</a>
      </main>
    `;
    setElementRect("button", { height: 32, width: 160, x: 20, y: 20 });
    setElementRect("a", { height: 32, width: 120, x: 20, y: 70 });

    const frame = captureRemoteAssistCoBrowseFrame({
      document,
      frameId: "frame-marked",
      now: 1_000,
      sessionId: "session-1",
      window,
    });

    expect(frame.surface?.controls).toEqual([
      expect.objectContaining({
        controlId: "pos-register",
        label: "Open register",
        role: "link",
      }),
    ]);
    expect(JSON.stringify(frame.surface?.controls)).not.toContain(
      "Global shell action",
    );
  });

  it("generates stable ids for base sidebar controls", () => {
    document.body.innerHTML = `
      <nav>
        <a
          href="/wigclub/store/wigclub/pos"
          data-sidebar="menu-button"
          data-remote-assist-control="sidebar-menu-button"
        >
          Point of Sale
        </a>
        <button
          data-sidebar="menu-button"
          data-remote-assist-control="sidebar-menu-button"
        >
          Operations
        </button>
      </nav>
    `;
    setElementRect("a", { height: 32, width: 140, x: 20, y: 20 });
    setElementRect("button", { height: 32, width: 120, x: 20, y: 70 });

    const frame = captureRemoteAssistCoBrowseFrame({
      document,
      frameId: "frame-sidebar",
      now: 1_000,
      sessionId: "session-1",
      window,
    });

    expect(frame.surface?.controls).toEqual([
      expect.objectContaining({
        controlId: "remote-assist-link-point-of-sale-wigclub-store-wigclub-pos",
        label: "Point of Sale",
        role: "link",
      }),
      expect.objectContaining({
        controlId: "remote-assist-button-operations",
        label: "Operations",
        role: "button",
      }),
    ]);
  });

  it("keeps selected surface controls when shell navigation exceeds the frame cap", () => {
    document.body.innerHTML = `
      <nav>
        ${Array.from({ length: 24 }, (_, index) => {
          const label = `Navigation ${index + 1}`;
          return `
            <a
              href="/wigclub/store/wigclub/nav-${index + 1}"
              data-sidebar="menu-button"
              data-remote-assist-control="sidebar-menu-button"
            >
              ${label}
            </a>
          `;
        }).join("")}
      </nav>
      <main>
        <a
          href="/wigclub/store/wigclub/pos/register"
          data-remote-assist-control="pos-workspace-feature"
          data-remote-assist-control-id="pos-workspace-pos"
          data-remote-assist-control-label="POS"
          data-remote-assist-control-role="link"
        >
          POS
        </a>
        <a
          href="/wigclub/store/wigclub/pos/expense-reports"
          data-remote-assist-control="pos-workspace-feature"
          data-remote-assist-control-id="pos-workspace-expense-reports"
          data-remote-assist-control-label="Expense Reports"
          data-remote-assist-control-role="link"
        >
          Expense Reports
        </a>
      </main>
    `;
    Array.from(document.querySelectorAll("nav a")).forEach((element, index) => {
      element.getBoundingClientRect = () =>
        ({
          bottom: 52 + index * 40,
          height: 32,
          left: 20,
          right: 180,
          toJSON: () => ({}),
          top: 20 + index * 40,
          width: 160,
          x: 20,
          y: 20 + index * 40,
        }) as DOMRect;
    });
    setElementRect('[data-remote-assist-control-id="pos-workspace-pos"]', {
      height: 120,
      width: 220,
      x: 240,
      y: 20,
    });
    setElementRect(
      '[data-remote-assist-control-id="pos-workspace-expense-reports"]',
      {
        height: 120,
        width: 220,
        x: 480,
        y: 20,
      },
    );

    const frame = captureRemoteAssistCoBrowseFrame({
      document,
      frameId: "frame-prioritized",
      now: 1_000,
      sessionId: "session-1",
      window,
    });

    expect(frame.surface?.controls).toHaveLength(24);
    expect(frame.surface?.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          controlId: "pos-workspace-pos",
          label: "POS",
        }),
        expect.objectContaining({
          controlId: "pos-workspace-expense-reports",
          label: "Expense Reports",
        }),
      ]),
    );
  });

  it("strips query strings from routes before publishing frames", () => {
    window.history.replaceState(
      null,
      "",
      "/pos/register?token=secret-token&customer=0240000000",
    );
    document.body.innerHTML = "<main>Register</main>";

    const frame = captureRemoteAssistCoBrowseFrame({
      document,
      frameId: "frame-2",
      now: 1_000,
      sessionId: "session-1",
      window,
    });

    expect(frame.route).toBe("/pos/register");
    expect(JSON.stringify(frame)).not.toContain("secret-token");
    expect(JSON.stringify(frame)).not.toContain("0240000000");
  });

  it("excludes controls and text inside sensitive containers", () => {
    document.body.innerHTML = `
      <main>
        <p>Safe checkout text</p>
        <section data-remote-assist-sensitive="customer-card">
          Customer secret 0240000000
        <button aria-label="Reveal customer" data-remote-assist-control="reveal-customer">Reveal customer</button>
        </section>
        <button aria-label="Safe action" data-remote-assist-control="safe-action">Safe action</button>
      </main>
    `;
    setElementRect("p", { height: 24, width: 160, x: 20, y: 20 });
    setElementRect("section", { height: 80, width: 200, x: 20, y: 60 });
    setElementRect("section button", { height: 32, width: 140, x: 30, y: 80 });
    setElementRect("main > button", { height: 32, width: 120, x: 20, y: 160 });

    const frame = captureRemoteAssistCoBrowseFrame({
      document,
      frameId: "frame-3",
      now: 1_000,
      sessionId: "session-1",
      window,
    });

    expect(frame.surface?.visibleText).toContain("Safe checkout text");
    expect(JSON.stringify(frame.surface)).not.toContain("Customer secret");
    expect(JSON.stringify(frame.surface)).not.toContain("0240000000");
    expect(frame.surface?.controls).toEqual([
      expect.objectContaining({
        label: "Safe action",
      }),
    ]);
  });

  it("applies allowed pointer controls and blocks sensitive regions", () => {
    const onClick = vi.fn();
    document.body.innerHTML = `
      <button aria-label="Open drawer" data-remote-assist-control="open-drawer">Open drawer</button>
      <input aria-label="PIN" type="password" />
    `;
    const button = document.querySelector("button")!;
    button.addEventListener("click", onClick);
    setElementRect("button", { height: 32, width: 120, x: 10, y: 10 });
    setElementRect("input", { height: 32, width: 120, x: 10, y: 80 });
    document.elementFromPoint = vi.fn((x, y) =>
      y < 60 ? button : document.querySelector("input"),
    ) as typeof document.elementFromPoint;

    const accepted = applyRemoteAssistControlIntent({
      document,
      intent: {
        event: {
          action: "up",
          pointerId: "support-pointer",
          type: "pointer",
          x: 30,
          y: 20,
        },
        idempotencyKey: "click-1",
        issuedAt: 1_000,
        reason: "test",
        sessionId: "session-1",
        target: "athena_surface",
      },
      window,
    });
    const blocked = applyRemoteAssistControlIntent({
      document,
      intent: {
        event: {
          action: "up",
          pointerId: "support-pointer",
          type: "pointer",
          x: 30,
          y: 90,
        },
        idempotencyKey: "click-2",
        issuedAt: 1_000,
        reason: "test",
        sessionId: "session-1",
        target: "athena_surface",
      },
      window,
    });

    expect(accepted.accepted).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(blocked).toMatchObject({
      accepted: false,
      reason: "sensitive_region",
    });
  });

  it("rejects pointer controls that do not land on marked Remote Assist controls", () => {
    const onClick = vi.fn();
    document.body.innerHTML = `<button aria-label="Unmarked">Unmarked</button>`;
    const button = document.querySelector("button")!;
    button.addEventListener("click", onClick);
    setElementRect("button", { height: 32, width: 120, x: 10, y: 10 });
    document.elementFromPoint = vi.fn(
      () => button,
    ) as typeof document.elementFromPoint;

    const result = applyRemoteAssistControlIntent({
      document,
      intent: {
        event: {
          action: "up",
          pointerId: "support-pointer",
          type: "pointer",
          x: 30,
          y: 20,
        },
        idempotencyKey: "unmarked-click",
        issuedAt: 1_000,
        reason: "test",
        sessionId: "session-1",
        target: "athena_surface",
      },
      window,
    });

    expect(result).toMatchObject({
      accepted: false,
      reason: "invalid_event",
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not apply duplicate control idempotency keys twice", () => {
    const onClick = vi.fn();
    document.body.innerHTML = `<button aria-label="Open drawer" data-remote-assist-control="open-drawer">Open drawer</button>`;
    const button = document.querySelector("button")!;
    button.addEventListener("click", onClick);
    setElementRect("button", { height: 32, width: 120, x: 10, y: 10 });
    document.elementFromPoint = vi.fn(
      () => button,
    ) as typeof document.elementFromPoint;
    const intent = {
      event: {
        action: "up" as const,
        pointerId: "support-pointer",
        type: "pointer" as const,
        x: 30,
        y: 20,
      },
      idempotencyKey: "click-once",
      issuedAt: 1_000,
      reason: "test",
      sessionId: "session-1",
      target: "athena_surface" as const,
    };

    const first = applyRemoteAssistControlIntent({ document, intent, window });
    const second = applyRemoteAssistControlIntent({ document, intent, window });

    expect(first.accepted).toBe(true);
    expect(second).toEqual(first);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

function setElementRect(
  selector: string,
  rect: { height: number; width: number; x: number; y: number },
) {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Missing element ${selector}`);
  }
  element.getBoundingClientRect = () =>
    ({
      bottom: rect.y + rect.height,
      height: rect.height,
      left: rect.x,
      right: rect.x + rect.width,
      toJSON: () => rect,
      top: rect.y,
      width: rect.width,
      x: rect.x,
      y: rect.y,
    }) as DOMRect;
}
