import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePrint } from "@/hooks/usePrint";

// Mock window.open and related APIs
const mockPrintWindow = {
  document: {
    write: vi.fn(),
    close: vi.fn(),
    readyState: "complete",
  },
  print: vi.fn(),
  close: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  closed: false,
  onload: null as any,
};

describe("usePrint Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset window.open mock
    (window.open as any) = vi.fn(() => mockPrintWindow);

    // Reset print window state
    mockPrintWindow.closed = false;
    mockPrintWindow.onload = null;
    mockPrintWindow.document.readyState = "complete";
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
      expect(htmlContent).toContain("<body>");
      expect(htmlContent).toContain('<div class="receipt">');
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

    it("should close window after printing with delay", () => {
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

      // Fast-forward timers to trigger window close
      vi.useFakeTimers();
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      vi.useRealTimers();

      expect(mockPrintWindow.close).toHaveBeenCalled();
    });

    it("should prevent multiple close attempts", () => {
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

      vi.useFakeTimers();
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      vi.useRealTimers();

      // Close should not be called on already closed window
      expect(mockPrintWindow.close).not.toHaveBeenCalled();
    });

    it("should handle fallback timeout for slow loading", () => {
      const { result } = renderHook(() => usePrint());

      // Set document as not ready
      mockPrintWindow.document.readyState = "loading";

      act(() => {
        result.current.printReceipt("<div>Test</div>");
      });

      // Don't trigger onload, let fallback timeout handle it
      vi.useFakeTimers();
      act(() => {
        vi.advanceTimersByTime(1000); // Fallback timeout
      });
      vi.useRealTimers();

      expect(mockPrintWindow.print).toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    it("should handle blocked popup window", () => {
      const { result } = renderHook(() => usePrint());

      // Mock window.open returning null (blocked popup)
      (window.open as any) = vi.fn(() => null);

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
    });

    it("should handle print errors gracefully", () => {
      const { result } = renderHook(() => usePrint());

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
    });

    it("should handle document.write errors", () => {
      const { result } = renderHook(() => usePrint());

      // Mock document.write to throw an error
      mockPrintWindow.document.write.mockImplementation(() => {
        throw new Error("Document write failed");
      });

      expect(() => {
        act(() => {
          result.current.printReceipt("<div>Test</div>");
        });
      }).not.toThrow();
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

    it("should include thermal printer optimizations", () => {
      const { result } = renderHook(() => usePrint());

      act(() => {
        result.current.printReceipt("<div>Test</div>");
      });

      const htmlContent = mockPrintWindow.document.write.mock.calls[0][0];
      expect(htmlContent).toContain("80mm");
      expect(htmlContent).toContain("Courier New");
      expect(htmlContent).toContain("@page");
    });
  });

  describe("Fallback Behavior", () => {
    it("should use document body fallback when popup is blocked", () => {
      const { result } = renderHook(() => usePrint());

      // Mock window.open returning null (blocked popup)
      (window.open as any) = vi.fn(() => null);

      // Mock document methods
      const mockDiv = {
        style: {},
        innerHTML: "",
      };
      const originalCreateElement = document.createElement;
      document.createElement = vi.fn(() => mockDiv as any);
      document.body.appendChild = vi.fn();

      const originalBodyInnerHTML = document.body.innerHTML;
      Object.defineProperty(document.body, "innerHTML", {
        get: () => originalBodyInnerHTML,
        set: vi.fn(),
        configurable: true,
      });

      act(() => {
        result.current.printReceipt("<div>Test Receipt</div>");
      });

      expect(document.createElement).toHaveBeenCalledWith("div");
      expect(document.body.appendChild).toHaveBeenCalled();

      // Restore original methods
      document.createElement = originalCreateElement;
    });
  });
});
