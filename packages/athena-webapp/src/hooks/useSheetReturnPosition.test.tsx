import { render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSheetReturnPosition, type SheetReturnFocus } from "./useSheetReturnPosition";
import { useSheetScrollPreservation } from "./useSheetScrollPreservation";

function mockScrollable(testId: string | null) {
  const scrollHeight = vi
    .spyOn(HTMLElement.prototype, "scrollHeight", "get")
    .mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === testId ? 2_000 : 0;
    });
  const clientHeight = vi
    .spyOn(HTMLElement.prototype, "clientHeight", "get")
    .mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === testId ? 600 : 0;
    });
  return () => {
    scrollHeight.mockRestore();
    clientHeight.mockRestore();
  };
}

/**
 * The preservation map is module-level and outlives any component — that is
 * the point of it, and it means a reused key carries an offset between tests.
 * Each render gets a fresh key unless a test is deliberately asserting
 * continuity across an unmount.
 */
let contextKeySeed = 0;

function Harness({
  contextKey,
  focus,
  isNavigationPending,
  isOpen,
  onComplete,
  scrollOffset,
  withPreservation,
}: {
  contextKey: string;
  focus?: SheetReturnFocus;
  isNavigationPending?: boolean;
  isOpen: boolean;
  onComplete?: () => void;
  scrollOffset?: number;
  withPreservation?: boolean;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const preservation = useSheetScrollPreservation({
    anchorRef,
    contextKey,
    isOpen,
  });
  useSheetReturnPosition({
    anchorRef,
    focus,
    isNavigationPending,
    isOpen,
    onComplete,
    preservation: withPreservation ? preservation : undefined,
    scrollOffset,
  });
  return <button ref={anchorRef} type="button" />;
}

function renderTree(
  props: Omit<Parameters<typeof Harness>[0], "contextKey"> & {
    contextKey?: string;
  },
) {
  const contextKey = props.contextKey ?? `ctx-${(contextKeySeed += 1)}`;
  return render(
    <div data-testid="scroller" style={{ overflowY: "auto" }}>
      {/* The observer watches the open dialog by default. */}
      <div role="dialog">
        <a data-return-key="present" href="#present">
          present
        </a>
      </div>
      <Harness {...props} contextKey={contextKey} />
    </div>,
  );
}

const presentFocus: SheetReturnFocus = {
  selector: '[data-return-key="present"]',
  isExpected: true,
  isReady: true,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSheetReturnPosition — scroll leg", () => {
  it("returns the page to the captured offset", async () => {
    const restore = mockScrollable("scroller");
    try {
      const onComplete = vi.fn();
      const { getByTestId } = renderTree({
        isOpen: true,
        onComplete,
        scrollOffset: 640,
      });

      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
      expect(getByTestId("scroller").scrollTop).toBe(640);
    } finally {
      restore();
    }
  });

  it("gives the keys back when the page never becomes scrollable", async () => {
    // The page can be shorter than when the offset was captured. Holding the
    // return keys forever would strand them in the URL.
    const restore = mockScrollable(null);
    try {
      const onComplete = vi.fn();
      renderTree({ isOpen: true, onComplete, scrollOffset: 640 });

      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1), {
        timeout: 3_000,
      });
    } finally {
      restore();
    }
  });

  it("completes without scrolling for an offset of zero", async () => {
    const restore = mockScrollable("scroller");
    try {
      const onComplete = vi.fn();
      const { getByTestId } = renderTree({
        isOpen: true,
        onComplete,
        scrollOffset: 0,
      });

      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
      expect(getByTestId("scroller").scrollTop).toBe(0);
    } finally {
      restore();
    }
  });

  it("keeps the in-mount offset coherent so closing does not jump to top", async () => {
    const restore = mockScrollable("scroller");
    try {
      const onComplete = vi.fn();
      const first = renderTree({
        contextKey: "shared-continuity",
        isOpen: true,
        onComplete,
        scrollOffset: 640,
        withPreservation: true,
      });
      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
      first.unmount();

      // A remount while still open re-pins from the preservation map, which
      // the scroll leg must have written on its way through.
      const second = renderTree({
        contextKey: "shared-continuity",
        isOpen: true,
        withPreservation: true,
      });
      expect(second.getByTestId("scroller").scrollTop).toBe(640);
    } finally {
      restore();
    }
  });

  it("does nothing while an outbound navigation is still in flight", async () => {
    // Consuming the token mid-departure would restore the position the
    // visitor is in the act of leaving.
    const restore = mockScrollable("scroller");
    try {
      const onComplete = vi.fn();
      const { getByTestId } = renderTree({
        isNavigationPending: true,
        isOpen: true,
        onComplete,
        scrollOffset: 640,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(getByTestId("scroller").scrollTop).toBe(0);
      expect(onComplete).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe("useSheetReturnPosition — focus leg", () => {
  it("returns focus to the element that was followed", async () => {
    const onComplete = vi.fn();
    const { getByText } = renderTree({
      focus: presentFocus,
      isOpen: true,
      onComplete,
    });

    await waitFor(() => expect(getByText("present")).toHaveFocus());
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("focuses the copy inside the sheet, not a duplicate on the page behind", async () => {
    // The same key is routinely rendered twice — a row in the sheet and a
    // preview of that row on the page. A document-wide lookup would focus
    // whichever came first in document order, which the visitor never touched.
    const outside = document.createElement("a");
    outside.setAttribute("data-return-key", "present");
    outside.setAttribute("href", "#outside");
    document.body.prepend(outside);

    try {
      const { getByText } = renderTree({ focus: presentFocus, isOpen: true });

      await waitFor(() => expect(getByText("present")).toHaveFocus());
      expect(outside).not.toHaveFocus();
    } finally {
      outside.remove();
    }
  });

  it("waits for a target that is expected but not mounted yet", async () => {
    // Chart axes and other async content mount after the page settles. An
    // elapsed frame is not evidence the row was removed.
    const onMissing = vi.fn();
    const { getByRole } = renderTree({
      focus: {
        selector: '[data-return-key="late"]',
        isExpected: true,
        isReady: true,
        onMissing,
      },
      isOpen: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onMissing).not.toHaveBeenCalled();

    const late = document.createElement("a");
    late.setAttribute("data-return-key", "late");
    late.setAttribute("href", "#late");
    getByRole("dialog").appendChild(late);

    await waitFor(() => expect(late).toHaveFocus());
    expect(onMissing).not.toHaveBeenCalled();
  });

  it("reports a target that is genuinely gone instead of waiting", async () => {
    const onComplete = vi.fn();
    const onMissing = vi.fn();
    renderTree({
      focus: {
        selector: '[data-return-key="removed"]',
        isExpected: false,
        isReady: true,
        onMissing,
      },
      isOpen: true,
      onComplete,
    });

    await waitFor(() => expect(onMissing).toHaveBeenCalledTimes(1));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("holds off until the caller's content has settled", async () => {
    const onMissing = vi.fn();
    const onComplete = vi.fn();
    renderTree({
      focus: { ...presentFocus, isExpected: false, isReady: false, onMissing },
      isOpen: true,
      onComplete,
    });

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(onMissing).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("gives the keys back without moving focus when nothing will ever settle", async () => {
    const onComplete = vi.fn();
    const onMissing = vi.fn();
    const { getByText } = renderTree({
      focus: { ...presentFocus, isUnavailable: true, onMissing },
      isOpen: true,
      onComplete,
    });

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(getByText("present")).not.toHaveFocus();
    expect(onMissing).not.toHaveBeenCalled();
  });
});

describe("useSheetReturnPosition — completion gate", () => {
  it("waits for BOTH legs before handing the keys back", async () => {
    // The caller clears its return keys here. Firing after the scroll leg
    // while focus is still waiting would delete the key focus needs.
    const restore = mockScrollable("scroller");
    try {
      const onComplete = vi.fn();
      const { getByRole, getByTestId } = renderTree({
        focus: {
          selector: '[data-return-key="late"]',
          isExpected: true,
          isReady: true,
        },
        isOpen: true,
        onComplete,
        scrollOffset: 640,
      });

      await waitFor(() => expect(getByTestId("scroller").scrollTop).toBe(640));
      expect(onComplete).not.toHaveBeenCalled();

      const late = document.createElement("a");
      late.setAttribute("data-return-key", "late");
      late.setAttribute("href", "#late");
      getByRole("dialog").appendChild(late);

      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    } finally {
      restore();
    }
  });

  it("stays silent when there is nothing to return to", async () => {
    const onComplete = vi.fn();
    renderTree({ isOpen: true, onComplete });

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("re-arms on close, so the next visit restores again", async () => {
    const onComplete = vi.fn();
    const first = renderTree({
      focus: presentFocus,
      isOpen: true,
      onComplete,
    });
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    first.rerender(
      <div data-testid="scroller" style={{ overflowY: "auto" }}>
        <div role="dialog" />
        <Harness
          contextKey="rearm"
          focus={presentFocus}
          isOpen={false}
          onComplete={onComplete}
        />
      </div>,
    );
    first.unmount();

    const second = renderTree({
      focus: presentFocus,
      isOpen: true,
      onComplete,
    });

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(2));
    expect(second.getByText("present")).toHaveFocus();
  });
});
