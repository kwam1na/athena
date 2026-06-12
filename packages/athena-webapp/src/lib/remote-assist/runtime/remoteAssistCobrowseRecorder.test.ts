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
        <button aria-label="Add item">Add item</button>
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
        label: "Add item",
        role: "button",
      }),
    ]);
    expect(frame.redaction.sensitiveRegionCount).toBe(1);
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
          <button aria-label="Reveal customer">Reveal customer</button>
        </section>
        <button aria-label="Safe action">Safe action</button>
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
      <button aria-label="Open drawer">Open drawer</button>
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

  it("does not apply duplicate control idempotency keys twice", () => {
    const onClick = vi.fn();
    document.body.innerHTML = `<button aria-label="Open drawer">Open drawer</button>`;
    const button = document.querySelector("button")!;
    button.addEventListener("click", onClick);
    setElementRect("button", { height: 32, width: 120, x: 10, y: 10 });
    document.elementFromPoint = vi.fn(() => button) as typeof document.elementFromPoint;
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
