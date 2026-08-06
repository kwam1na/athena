import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  findScrollableAncestor,
  useSheetScrollPreservation,
  type SheetScrollPreservation,
} from "./useSheetScrollPreservation";

/**
 * jsdom reports 0 for every layout box, so a container only looks scrollable
 * if its metrics are stubbed — the same approach the sheet's own tests take.
 * Keyed off `data-testid` so a test can make exactly one element scrollable.
 */
function mockScrollable(testId: string) {
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

let api: SheetScrollPreservation | null = null;

function Harness({
  contextKey,
  isOpen,
}: {
  contextKey: string;
  isOpen: boolean;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  api = useSheetScrollPreservation({ anchorRef, contextKey, isOpen });
  return <button ref={anchorRef} type="button" />;
}

function renderTree(args: {
  contextKey?: string;
  isOpen: boolean;
  testId?: string;
}) {
  const testId = args.testId ?? "scroller";
  return render(
    <div data-testid={testId} style={{ overflowY: "auto" }}>
      <Harness contextKey={args.contextKey ?? "ctx"} isOpen={args.isOpen} />
    </div>,
  );
}

afterEach(() => {
  api?.clear();
  api = null;
});

describe("findScrollableAncestor", () => {
  it("skips an ancestor that declares scrolling but has nothing to scroll", () => {
    // `overflowY` alone is not evidence: restoring onto a container with no
    // overflow writes a scrollTop that silently stays 0.
    const restore = mockScrollable("real-scroller");
    try {
      const { getByRole } = render(
        <div data-testid="real-scroller" style={{ overflowY: "auto" }}>
          <div data-testid="empty-scroller" style={{ overflowY: "auto" }}>
            <button type="button" />
          </div>
        </div>,
      );

      expect(
        findScrollableAncestor(getByRole("button"))?.dataset.testid,
      ).toBe("real-scroller");
    } finally {
      restore();
    }
  });

  it("skips an overflowing ancestor that does not scroll itself", () => {
    // Content taller than the box scrolls an ANCESTOR when overflow is
    // visible, so this element's own scrollTop would go nowhere.
    const restore = mockScrollable("overflowing-static");
    try {
      const { getByRole } = render(
        <div data-testid="overflowing-static" style={{ overflowY: "visible" }}>
          <button type="button" />
        </div>,
      );

      expect(findScrollableAncestor(getByRole("button"))).toBeNull();
    } finally {
      restore();
    }
  });

  it("returns the element itself when that is what scrolls", () => {
    // A caller may hold a ref to the container rather than to a trigger
    // inside it — the timeline sheet does exactly that.
    const restore = mockScrollable("self-scroller");
    try {
      const { getByTestId } = render(
        <div data-testid="self-scroller" style={{ overflowY: "auto" }} />,
      );

      expect(findScrollableAncestor(getByTestId("self-scroller"))).toBe(
        getByTestId("self-scroller"),
      );
    } finally {
      restore();
    }
  });

  it("returns null rather than throwing for a detached anchor", () => {
    expect(findScrollableAncestor(null)).toBeNull();
    expect(findScrollableAncestor(undefined)).toBeNull();
  });
});

describe("useSheetScrollPreservation", () => {
  it("re-pins the captured offset when the page underneath remounts", () => {
    // The reason this exists: a remount gives the scroller a fresh DOM node
    // with scrollTop 0 while the sheet is still open over it.
    const restore = mockScrollable("scroller");
    try {
      const first = renderTree({ isOpen: false });
      first.getByTestId("scroller").scrollTop = 640;
      api!.capture();
      first.unmount();

      const second = renderTree({ isOpen: true });

      expect(second.getByTestId("scroller").scrollTop).toBe(640);
    } finally {
      restore();
    }
  });

  it("leaves the page alone while the sheet is closed", () => {
    const restore = mockScrollable("scroller");
    try {
      const first = renderTree({ isOpen: false });
      first.getByTestId("scroller").scrollTop = 640;
      api!.capture();
      first.unmount();

      const second = renderTree({ isOpen: false });

      expect(second.getByTestId("scroller").scrollTop).toBe(0);
    } finally {
      restore();
    }
  });

  it("forgets the offset on clear, so a later open starts at the top", () => {
    const restore = mockScrollable("scroller");
    try {
      const first = renderTree({ isOpen: false });
      first.getByTestId("scroller").scrollTop = 640;
      api!.capture();
      api!.clear();
      first.unmount();

      const second = renderTree({ isOpen: true });

      expect(second.getByTestId("scroller").scrollTop).toBe(0);
      expect(api!.peek()).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("keys offsets separately, so one sheet cannot move another's page", () => {
    const restore = mockScrollable("scroller");
    try {
      const first = renderTree({ contextKey: "left", isOpen: false });
      first.getByTestId("scroller").scrollTop = 640;
      api!.capture();
      first.unmount();

      // A different context has captured nothing and must not inherit 640.
      const second = renderTree({ contextKey: "right", isOpen: true });
      expect(second.getByTestId("scroller").scrollTop).toBe(0);
      second.unmount();

      const third = renderTree({ contextKey: "left", isOpen: true });
      expect(third.getByTestId("scroller").scrollTop).toBe(640);
      api!.clear();
    } finally {
      restore();
    }
  });

  it("records nothing when the anchor has no scrollable ancestor", () => {
    // A sheet opened from a page that does not scroll: capture must be inert
    // rather than storing a meaningless zero that later pins the page.
    const { unmount } = renderTree({ isOpen: false });
    api!.capture();

    expect(api!.peek()).toBeUndefined();
    unmount();
  });

  it("accepts an offset restored from elsewhere", () => {
    // `remember` is for a caller that restores from a route param and needs
    // this map to agree, so closing afterwards does not jump to the top.
    const restore = mockScrollable("scroller");
    try {
      const first = renderTree({ isOpen: false });
      api!.remember(320);
      expect(api!.peek()).toBe(320);
      first.unmount();

      const second = renderTree({ isOpen: true });
      expect(second.getByTestId("scroller").scrollTop).toBe(320);
    } finally {
      restore();
    }
  });
});
