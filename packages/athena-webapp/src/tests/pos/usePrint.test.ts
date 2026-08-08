import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const printTelemetryMocks = vi.hoisted(() => ({
  begin: vi.fn((): string | undefined => "attempt-1"),
  event: vi.fn(),
  finalize: vi.fn(),
  invocation: vi.fn(),
  returned: vi.fn(),
}));

vi.mock("@/lib/pos/infrastructure/telemetry/printAttemptTelemetry", () => ({
  beginPrintAttempt: printTelemetryMocks.begin,
  finalizePrintAttempt: printTelemetryMocks.finalize,
  recordPrintAttemptEvent: printTelemetryMocks.event,
  recordPrintInvocation: printTelemetryMocks.invocation,
  recordPrintReturn: printTelemetryMocks.returned,
}));

import { usePrint } from "@/hooks/usePrint";

// Mock window.open and related APIs
const mockPrintWindow = {
  document: {
    write: vi.fn(),
    close: vi.fn(),
    readyState: "complete",
    querySelector: vi.fn(),
    createElement: vi.fn(),
    head: {
      appendChild: vi.fn(),
    },
  },
  print: vi.fn(),
  close: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  closed: false,
  onload: null as null | (() => void),
};

/** Fire an event the hook registered on the print window via addEventListener. */
function emitPrintWindowEvent(type: string) {
  for (const [eventType, handler] of mockPrintWindow.addEventListener.mock
    .calls as Array<[string, () => void]>) {
    if (eventType === type) handler();
  }
}

function setWindowOpenMock(returnValue: Window | null) {
  Object.defineProperty(window, "open", {
    configurable: true,
    value: vi.fn(() => returnValue),
  });
}

describe("usePrint Hook", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mockPrintWindow.document.write.mockReset();
    mockPrintWindow.document.close.mockReset();
    mockPrintWindow.document.querySelector.mockReset();
    mockPrintWindow.document.createElement.mockReset();
    mockPrintWindow.document.head.appendChild.mockReset();
    mockPrintWindow.print.mockReset();
    mockPrintWindow.close.mockReset();
    mockPrintWindow.addEventListener.mockReset();
    mockPrintWindow.removeEventListener.mockReset();
    printTelemetryMocks.begin.mockClear();
    printTelemetryMocks.event.mockClear();
    printTelemetryMocks.finalize.mockClear();
    printTelemetryMocks.invocation.mockClear();
    printTelemetryMocks.returned.mockClear();

    // Reset window.open mock
    setWindowOpenMock(mockPrintWindow as unknown as Window);

    // Reset print window state
    mockPrintWindow.closed = false;
    mockPrintWindow.onload = null;
    mockPrintWindow.document.readyState = "complete";
    mockPrintWindow.document.querySelector.mockReturnValue(null);
    mockPrintWindow.document.createElement.mockImplementation(() => ({
      setAttribute: vi.fn(),
      textContent: "",
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Basic Functionality", () => {
    it("should open print window with correct parameters", () => {
      const { result } = renderHook(() => usePrint());

      act(() => {
        result.current.printReceipt("<div>Test Receipt</div>");
      });

      expect(window.open).toHaveBeenCalledWith(
        "",
        "_blank",
        "width=300,height=600,scrollbars=yes"
      );
      expect(mockPrintWindow.document.write).toHaveBeenCalled();
      expect(mockPrintWindow.document.close).toHaveBeenCalled();
    });

    it("should write HTML content to print window", () => {
      const { result } = renderHook(() => usePrint());
      const testHTML = "<div>Test Receipt Content</div>";

      act(() => {
        result.current.printReceipt(testHTML);
      });

      const htmlContent = mockPrintWindow.document.write.mock.calls[0][0];
      expect(htmlContent).toContain("<!DOCTYPE html>");
      expect(htmlContent).toContain("<html>");
      expect(htmlContent).toContain("<head>");
      expect(htmlContent).toContain('<meta charset="UTF-8">');
      expect(htmlContent).toContain("<body>");
      expect(htmlContent).toContain('<div class="receipt">');
    });

    it("never passes receipt content into the telemetry helper", () => {
      const sensitiveSentinel = "CUSTOMER-SENTINEL-4471";
      const { result } = renderHook(() => usePrint());

      act(() => {
        result.current.printReceipt(`<div>${sensitiveSentinel}</div>`);
        mockPrintWindow.onload?.();
      });

      expect(
        JSON.stringify({
          event: printTelemetryMocks.event.mock.calls,
          finalize: printTelemetryMocks.finalize.mock.calls,
          invocation: printTelemetryMocks.invocation.mock.calls,
          returned: printTelemetryMocks.returned.mock.calls,
        }),
      ).not.toContain(sensitiveSentinel);
    });

    it("should include CSS styles for receipt formatting", () => {
      const { result } = renderHook(() => usePrint());

      act(() => {
        result.current.printReceipt("<div>Test</div>");
      });

      const htmlContent = mockPrintWindow.document.write.mock.calls[0][0];
      expect(htmlContent).toContain("<style>");
      expect(htmlContent).toContain("font-family:");
      expect(htmlContent).toContain("@media print");
      expect(htmlContent).toContain("@page");
    });

    it("should set up onload handler", () => {
      const { result } = renderHook(() => usePrint());

      act(() => {
        result.current.printReceipt("<div>Test</div>");
      });

      expect(mockPrintWindow.onload).toBeDefined();
      expect(typeof mockPrintWindow.onload).toBe("function");
    });

    it("should add event listeners for window tracking", () => {
      const { result } = renderHook(() => usePrint());

      act(() => {
        result.current.printReceipt("<div>Test</div>");
      });

      expect(mockPrintWindow.addEventListener).toHaveBeenCalledWith(
        "beforeunload",
        expect.any(Function)
      );
      expect(mockPrintWindow.addEventListener).toHaveBeenCalledWith(
        "unload",
        expect.any(Function)
      );
    });
  });

  describe("Print Window Management", () => {
    it("keeps the same print path when the terminal is not targeted", () => {
      printTelemetryMocks.begin.mockReturnValueOnce(undefined);
      const { result } = renderHook(() => usePrint());

      act(() => {
        result.current.printReceipt("<div>Test</div>");
        mockPrintWindow.onload?.();
      });

      expect(mockPrintWindow.print).toHaveBeenCalledTimes(1);
      expect(printTelemetryMocks.invocation).toHaveBeenCalledWith(undefined, {
        source: "load",
        readyState: "complete",
        windowClosed: false,
      });
    });

    it("records the unchanged load branch and synchronous print return", () => {
      const { result } = renderHook(() => usePrint());

      act(() => {
        result.current.printReceipt("<div>Test</div>");
        mockPrintWindow.onload?.();
      });

      expect(printTelemetryMocks.begin).toHaveBeenCalledTimes(1);
      expect(printTelemetryMocks.invocation).toHaveBeenCalledWith(
        "attempt-1",
        {
          source: "load",
          readyState: "complete",
          windowClosed: false,
        },
      );
      expect(printTelemetryMocks.returned).toHaveBeenCalledWith(
        "attempt-1",
        undefined,
      );
    });

    it("should call print when window loads", () => {
      const { result } = renderHook(() => usePrint());

      act(() => {
        result.current.printReceipt("<div>Test</div>");
      });

      // Simulate window load event
      act(() => {
        if (mockPrintWindow.onload) {
          mockPrintWindow.onload();
        }
      });

      expect(mockPrintWindow.print).toHaveBeenCalled();
    });

    it("closes the window once the browser reports the print finished", () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => usePrint());

      act(() => {
        result.current.printReceipt("<div>Test</div>");
      });

      // Simulate window load and print
      act(() => {
        if (mockPrintWindow.onload) {
          mockPrintWindow.onload();
        }
      });

      act(() => {
        emitPrintWindowEvent("afterprint");
        vi.advanceTimersByTime(250);
      });
      vi.useRealTimers();

      expect(mockPrintWindow.close).toHaveBeenCalled();
    });

    it("keeps the window alive while the print dialog is still up", () => {
      // The old fixed teardown timer discarded the browsing context mid-print,
      // which is what produced "The provided callback is no longer runnable".
      vi.useFakeTimers();
      mockPrintWindow.close.mockImplementation(() => {
        emitPrintWindowEvent("beforeunload");
        emitPrintWindowEvent("unload");
      });
      const { result } = renderHook(() => usePrint());

      act(() => {
        result.current.printReceipt("<div>Test</div>");
      });
      act(() => {
        mockPrintWindow.onload?.();
      });

      // No afterprint yet: the dialog is still open.
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(mockPrintWindow.close).not.toHaveBeenCalled();

      // A browser that never fires afterprint still gets cleaned up.
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      vi.useRealTimers();

      expect(mockPrintWindow.close).toHaveBeenCalledTimes(1);
      expect(printTelemetryMocks.event).toHaveBeenCalledWith(
        "attempt-1",
        "beforeunload",
        false,
      );
      expect(printTelemetryMocks.event).toHaveBeenCalledWith(
        "attempt-1",
        "unload",
        false,
      );
      expect(printTelemetryMocks.finalize).toHaveBeenCalledWith(
        "attempt-1",
        "fallback_cleanup",
        false,
      );
    });

    it("should prevent multiple close attempts", () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => usePrint());

      act(() => {
        result.current.printReceipt("<div>Test</div>");
      });

      // Simulate window load and print
      act(() => {
        if (mockPrintWindow.onload) {
          mockPrintWindow.onload();
        }
      });

      // Simulate window already closed
      mockPrintWindow.closed = true;

      act(() => {
        emitPrintWindowEvent("afterprint");
        vi.advanceTimersByTime(60_000);
      });
      vi.useRealTimers();

      // Close should not be called on already closed window
      expect(mockPrintWindow.close).not.toHaveBeenCalled();
    });

    it("should handle fallback timeout for slow loading", () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => usePrint());

      // Set document as not ready
      mockPrintWindow.document.readyState = "loading";

      act(() => {
        result.current.printReceipt("<div>Test</div>");
      });

      // Don't trigger onload, let fallback timeout handle it
      act(() => {
        vi.advanceTimersByTime(1000); // Fallback timeout
      });
      vi.useRealTimers();

      expect(mockPrintWindow.print).toHaveBeenCalled();
      expect(printTelemetryMocks.invocation).toHaveBeenCalledWith(
        "attempt-1",
        {
          source: "1s-fallback",
          readyState: "loading",
          windowClosed: false,
        },
      );
    });

    it("records afterprint before print returns and finalizes afterwards", () => {
      vi.useFakeTimers();
      mockPrintWindow.print.mockImplementation(() => {
        emitPrintWindowEvent("afterprint");
      });
      mockPrintWindow.close.mockImplementation(() => {
        emitPrintWindowEvent("beforeunload");
        emitPrintWindowEvent("unload");
      });
      const { result } = renderHook(() => usePrint());

      act(() => {
        result.current.printReceipt("<div>Test</div>");
        mockPrintWindow.onload?.();
        vi.advanceTimersByTime(250);
      });
      vi.useRealTimers();

      expect(printTelemetryMocks.event).toHaveBeenCalledWith(
        "attempt-1",
        "afterprint",
        false,
      );
      expect(printTelemetryMocks.event).toHaveBeenCalledWith(
        "attempt-1",
        "beforeunload",
        false,
      );
      expect(printTelemetryMocks.event).toHaveBeenCalledWith(
        "attempt-1",
        "unload",
        false,
      );
      expect(printTelemetryMocks.returned).toHaveBeenCalled();
      expect(printTelemetryMocks.finalize).toHaveBeenCalledWith(
        "attempt-1",
        "afterprint",
        false,
      );
      expect(
        printTelemetryMocks.returned.mock.invocationCallOrder[0],
      ).toBeLessThan(printTelemetryMocks.finalize.mock.invocationCallOrder[0]);
    });
  });

  describe("Error Handling", () => {
    it("does not print into a window that is already closed", () => {
      // Chrome answers a print() on a discarded browsing context with
      // "Failed to execute 'print' on 'Window': The provided callback is no
      // longer runnable", which is what surfaced as unhandled rejections on the
      // production terminal during rapid sales.
      const { result } = renderHook(() => usePrint());

      act(() => {
        result.current.printReceipt("<div>Test</div>");
      });

      mockPrintWindow.closed = true;

      act(() => {
        mockPrintWindow.onload?.();
      });

      expect(mockPrintWindow.print).not.toHaveBeenCalled();
    });

    it("prints once when the load handler and the slow-load fallback both fire", () => {
      // The fallback used to re-invoke onload directly, so a slow document
      // could print twice — the second landing on a window already scheduled
      // for teardown.
      vi.useFakeTimers();
      const { result } = renderHook(() => usePrint());
      mockPrintWindow.document.readyState = "loading";

      act(() => {
        result.current.printReceipt("<div>Test</div>");
      });
      act(() => {
        mockPrintWindow.onload?.();
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      vi.useRealTimers();

      expect(mockPrintWindow.print).toHaveBeenCalledTimes(1);
    });

    it("does not print after the window has begun closing", () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => usePrint());
      mockPrintWindow.document.readyState = "loading";

      act(() => {
        result.current.printReceipt("<div>Test</div>");
      });

      // The operator dismisses the popup before it finished loading.
      act(() => {
        emitPrintWindowEvent("unload");
      });

      // The slow-load fallback fires afterwards and must stay quiet rather than
      // printing into a context that is already going away.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      vi.useRealTimers();

      expect(mockPrintWindow.print).not.toHaveBeenCalled();
      expect(printTelemetryMocks.event).toHaveBeenCalledWith(
        "attempt-1",
        "unload",
        false,
      );
      expect(printTelemetryMocks.finalize).toHaveBeenCalledWith(
        "attempt-1",
        "unload",
        false,
      );
    });

    it("does not close the window a second time after it unloads itself", () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => usePrint());

      act(() => {
        result.current.printReceipt("<div>Test</div>");
      });
      act(() => {
        mockPrintWindow.onload?.();
      });
      act(() => {
        emitPrintWindowEvent("unload");
        vi.advanceTimersByTime(60_000);
      });
      vi.useRealTimers();

      expect(mockPrintWindow.close).not.toHaveBeenCalled();
    });

    it("should handle blocked popup window", () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const { result } = renderHook(() => usePrint());

      // Mock window.open returning null (blocked popup)
      setWindowOpenMock(null);

      expect(() => {
        act(() => {
          result.current.printReceipt("<div>Test</div>");
        });
      }).not.toThrow();

      expect(window.open).toHaveBeenCalledWith(
        "",
        "_blank",
        "width=300,height=600,scrollbars=yes"
      );
      expect(consoleError).toHaveBeenCalledWith(
        "Could not open print window - may be blocked by popup blocker"
      );
    });

    it("should handle print errors gracefully", () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const { result } = renderHook(() => usePrint());
      mockPrintWindow.close.mockImplementation(() => {
        emitPrintWindowEvent("beforeunload");
        emitPrintWindowEvent("unload");
      });

      // Mock print to throw an error
      mockPrintWindow.print.mockImplementation(() => {
        throw new Error("Print failed");
      });

      expect(() => {
        act(() => {
          result.current.printReceipt("<div>Test</div>");
        });

        // Simulate window load
        act(() => {
          if (mockPrintWindow.onload) {
            mockPrintWindow.onload();
          }
        });
      }).not.toThrow();

      expect(mockPrintWindow.print).toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        "Error during printing:",
        expect.any(Error)
      );
      expect(printTelemetryMocks.finalize).toHaveBeenCalledWith(
        "attempt-1",
        "sync_throw",
        false,
      );
    });

    it("should handle document.write errors", () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const { result } = renderHook(() => usePrint());
      mockPrintWindow.close.mockImplementation(() => {
        emitPrintWindowEvent("beforeunload");
        emitPrintWindowEvent("unload");
      });

      // Mock document.write to throw an error
      mockPrintWindow.document.write.mockImplementation(() => {
        throw new Error("Document write failed");
      });

      expect(() => {
        act(() => {
          result.current.printReceipt("<div>Test</div>");
        });
      }).not.toThrow();
      expect(consoleError).toHaveBeenCalledWith(
        "Error preparing print window:",
        expect.any(Error)
      );
      expect(printTelemetryMocks.finalize).toHaveBeenCalledWith(
        "attempt-1",
        "preparation_throw",
        false,
      );
    });

    it("should handle empty content gracefully", () => {
      const { result } = renderHook(() => usePrint());

      expect(() => {
        act(() => {
          result.current.printReceipt("");
        });
      }).not.toThrow();

      expect(mockPrintWindow.document.write).toHaveBeenCalled();
    });
  });

  describe("Content Processing", () => {
    it("should preserve HTML content in receipt div", () => {
      const { result } = renderHook(() => usePrint());
      const testContent = "<h1>Receipt Title</h1><p>Item 1: $10.00</p>";

      act(() => {
        result.current.printReceipt(testContent);
      });

      const htmlContent = mockPrintWindow.document.write.mock.calls[0][0];
      expect(htmlContent).toContain('<div class="receipt">');
      // The content should be placed inside the receipt div
      expect(htmlContent).toContain("Receipt Title");
      expect(htmlContent).toContain("Item 1: $10.00");
    });

    it("should handle special characters in content", () => {
      const { result } = renderHook(() => usePrint());
      const testContent = "<p>Price: $29.99 & tax: 10%</p>";

      act(() => {
        result.current.printReceipt(testContent);
      });

      const htmlContent = mockPrintWindow.document.write.mock.calls[0][0];
      expect(htmlContent).toContain("$29.99");
      expect(htmlContent).toContain("10%");
    });

    it("should preserve cedi symbols in receipt currency", () => {
      const { result } = renderHook(() => usePrint());

      act(() => {
        result.current.printReceipt(
          "<p>Total: GH₵1,878.99</p><p>Change: &#x20B5;12.00</p>"
        );
      });

      const htmlContent = mockPrintWindow.document.write.mock.calls[0][0];
      expect(htmlContent).toContain("Total: GH₵1,878.99");
      expect(htmlContent).toContain("Change: &#x20B5;12.00");
    });

    it("should include thermal printer optimizations", () => {
      const { result } = renderHook(() => usePrint());

      act(() => {
        result.current.printReceipt("<div>Test</div>");
      });

      const htmlContent = mockPrintWindow.document.write.mock.calls[0][0];
      expect(htmlContent).toContain("80mm");
      expect(htmlContent).toContain("DejaVu Sans");
      expect(htmlContent).toContain("@page");
    });

    it("should set a continuous receipt page height before printing", () => {
      const styleElement = {
        setAttribute: vi.fn(),
        textContent: "",
      };
      const receiptElement = {
        scrollHeight: 1800,
        getBoundingClientRect: () => ({ height: 1600 }),
      };

      mockPrintWindow.document.querySelector.mockImplementation(
        (selector: string) => {
          if (selector === ".receipt") return receiptElement;
          if (selector === "style[data-receipt-page-size]") return null;
          return null;
        }
      );
      mockPrintWindow.document.createElement.mockReturnValue(styleElement);

      const { result } = renderHook(() => usePrint());

      act(() => {
        result.current.printReceipt("<div>Test</div>");
      });

      act(() => {
        mockPrintWindow.onload?.();
      });

      expect(styleElement.setAttribute).toHaveBeenCalledWith(
        "data-receipt-page-size",
        "continuous"
      );
      expect(styleElement.textContent).toContain("@page");
      expect(styleElement.textContent).toContain("size: 80mm 485mm");
      expect(mockPrintWindow.document.head.appendChild).toHaveBeenCalledWith(
        styleElement
      );
      expect(mockPrintWindow.print).toHaveBeenCalled();
    });

    it("should force receipt text to print dark and legibly", () => {
      const { result } = renderHook(() => usePrint());

      act(() => {
        result.current.printReceipt(
          '<p style="color: #999999; opacity: 0.45; font-weight: 400;">Muted label</p>'
        );
      });

      const htmlContent = mockPrintWindow.document.write.mock.calls[0][0];
      expect(htmlContent).toContain("color: #000 !important");
      expect(htmlContent).toContain("font-family: Arial");
      expect(htmlContent).toContain("-webkit-text-fill-color: #000 !important");
      expect(htmlContent).toContain("opacity: 1 !important");
      expect(htmlContent).toContain("font-weight: 700 !important");
    });

    it("should remove the receipt template outer border", () => {
      const { result } = renderHook(() => usePrint());

      act(() => {
        result.current.printReceipt(
          '<table style="border: 1px solid #111111;"><tr><td>Receipt</td></tr></table>'
        );
      });

      const htmlContent = mockPrintWindow.document.write.mock.calls[0][0];
      expect(htmlContent).toContain(".receipt > table");
      expect(htmlContent).toContain(".receipt > div");
      expect(htmlContent).toContain("border: 0 !important");
      expect(htmlContent).toContain("box-shadow: none !important");
      expect(htmlContent).toContain("outline: 0 !important");
    });
  });

  describe("Fallback Behavior", () => {
    it("should use document body fallback when popup is blocked", () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const { result } = renderHook(() => usePrint());

      // Mock window.open returning null (blocked popup)
      setWindowOpenMock(null);

      const mockDiv = document.createElement("div");
      const createElementSpy = vi
        .spyOn(document, "createElement")
        .mockReturnValue(mockDiv);
      const appendChildSpy = vi
        .spyOn(document.body, "appendChild")
        .mockReturnValue(mockDiv);

      const originalBodyInnerHTML = document.body.innerHTML;
      const bodySetter = vi.fn();
      const printSpy = vi.fn();
      Object.defineProperty(window, "print", {
        configurable: true,
        value: printSpy,
      });
      Object.defineProperty(document.body, "innerHTML", {
        get: () => originalBodyInnerHTML,
        set: bodySetter,
        configurable: true,
      });

      act(() => {
        result.current.printReceipt("<div>Test Receipt</div>");
      });

      expect(createElementSpy).toHaveBeenCalledWith("div");
      expect(appendChildSpy).toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        "Could not open print window - may be blocked by popup blocker"
      );
      expect(mockDiv.innerHTML).toContain("<style>");
      expect(mockDiv.innerHTML).toContain("color: #000 !important");
      expect(mockDiv.innerHTML).toContain("border: 0 !important");
      expect(printSpy).toHaveBeenCalledTimes(1);
      expect(bodySetter).toHaveBeenNthCalledWith(
        2,
        originalBodyInnerHTML,
      );
      expect(printTelemetryMocks.invocation).toHaveBeenCalledWith(
        "attempt-1",
        {
          source: "current-window",
          readyState: document.readyState,
          windowClosed: false,
        },
      );
      expect(printTelemetryMocks.returned).toHaveBeenCalledWith(
        "attempt-1",
        undefined,
      );
      expect(printTelemetryMocks.finalize).toHaveBeenCalledWith(
        "attempt-1",
        "popup_blocked_fallback",
        false,
      );
    });

    it("preserves a blocked-popup print throw while recording it", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      setWindowOpenMock(null);
      const printError = new Error("Current window print failed");
      Object.defineProperty(window, "print", {
        configurable: true,
        value: vi.fn(() => {
          throw printError;
        }),
      });
      const { result } = renderHook(() => usePrint());

      expect(() => {
        act(() => {
          result.current.printReceipt("<div>Test</div>");
        });
      }).toThrow(printError);

      expect(printTelemetryMocks.finalize).toHaveBeenCalledWith(
        "attempt-1",
        "sync_throw",
        false,
      );
    });
  });
});
