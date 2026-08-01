import { useCallback } from "react";

const RECEIPT_PAGE_WIDTH_MM = 80;
const RECEIPT_MIN_PAGE_HEIGHT_MM = 120;
const RECEIPT_PAGE_HEIGHT_BUFFER_MM = 8;
const CSS_PIXELS_PER_MM = 96 / 25.4;
// Small breather after `afterprint` so the browser finishes unwinding the print
// pipeline before the browsing context goes away.
const AFTER_PRINT_CLOSE_DELAY_MS = 250;
// Only for browsers that never fire `afterprint`. Long enough that it cannot
// fire while a print dialog is still open on the terminal.
const PRINT_FALLBACK_CLOSE_MS = 60_000;

const receiptPrintStyles = `
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            
            body {
              font-family: Arial, 'Helvetica Neue', Helvetica, 'DejaVu Sans', sans-serif;
              font-size: 13px;
              line-height: 1.35;
              color: #000;
              background: #fff;
              padding: 0;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              font-weight: 800;
            }
           
            .receipt {
              max-width: 80mm;
              margin: 0 auto;
              width: 100%;
            }
            
            .text-center {
              text-align: center;
            }
            
            .text-xs {
              font-size: 11px;
              font-weight: 700;
            }
            
            .text-sm {
              font-size: 12px;
              font-weight: 700;
            }
            
            .text-base {
              font-size: 13px;
              font-weight: 700;
            }
            
            .text-lg {
              font-size: 16px;
              font-weight: 900;
            }
            
            .font-bold {
              font-weight: 900;
            }
            
            .mb-1 {
              margin-bottom: 4px;
            }
            
            .mb-2 {
              margin-bottom: 8px;
            }
            
            .mb-3 {
              margin-bottom: 12px;
            }
            
            .mb-4 {
              margin-bottom: 16px;
            }
            
            .mb-6 {
              margin-bottom: 24px;
            }
            
            .mt-2 {
              margin-top: 8px;
            }
            
            .mt-4 {
              margin-top: 16px;
            }
            
            .mt-6 {
              margin-top: 24px;
            }
            
            .pb-4 {
              padding-bottom: 16px;
            }
            
            .pt-2 {
              padding-top: 8px;
            }
            
            .pt-4 {
              padding-top: 16px;
            }
            
            .border-b {
              border-bottom: 2px dashed #000;
            }
            
            .border-t {
              border-top: 2px solid #000;
            }
            
            .flex {
              display: flex;
            }
            
            .justify-between {
              justify-content: space-between;
            }
            
            .space-y-1 > * + * {
              margin-top: 4px;
            }
            
            .whitespace-nowrap {
              white-space: nowrap;
            }
            
            .truncate {
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }
            
            .flex-1 {
              flex: 1;
            }
            
            .pr-2 {
              padding-right: 8px;
            }
            
            .ml-2 {
              margin-left: 8px;
            }
            
            @page {
              size: ${RECEIPT_PAGE_WIDTH_MM}mm auto;
              margin: 0;
            }
             
            /* Fallback for browsers that don't support custom page sizes */
            @page :first {
              size: ${RECEIPT_PAGE_WIDTH_MM}mm auto;
              margin: 0;
            }
            
            @media print {
              body {
                padding: 0;
                margin: 0;
                width: 80mm;
                font-size: 11px;
                font-weight: 700;
                color: #000 !important;
              }
              
              .receipt {
                max-width: none;
                width: 100%;
                margin: 0;
                padding: 0;
              }
              
              .text-lg {
                font-size: 14px;
                font-weight: 900 !important;
              }
              
              .text-base {
                font-size: 11px;
                font-weight: 700 !important;
              }
              
              .text-sm {
                font-size: 10px;
                font-weight: 700 !important;
              }
              
              .text-xs {
                font-size: 9px;
                font-weight: 700 !important;
              }
              
              .border-b {
                border-bottom: 2px dashed #000 !important;
              }
              
              .border-t {
                border-top: 2px solid #000 !important;
              }
              
              .font-bold {
                font-weight: 900 !important;
              }
               
              /* Ensure proper spacing for thermal printers */
              .mb-1 { margin-bottom: 2mm !important; }
              .mb-2 { margin-bottom: 3mm !important; }
              .mb-3 { margin-bottom: 4mm !important; }
              .mb-4 { margin-bottom: 5mm !important; }
              .mb-6 { margin-bottom: 6mm !important; }
              .pb-4 { padding-bottom: 3mm !important; }
              .pt-2 { padding-top: 2mm !important; }
              .pt-4 { padding-top: 3mm !important; }
            }

            .receipt,
            .receipt * {
              color: #000 !important;
              -webkit-text-fill-color: #000 !important;
              font-family: Arial, 'Helvetica Neue', Helvetica, 'DejaVu Sans', sans-serif !important;
              opacity: 1 !important;
              text-shadow: none !important;
            }

            .receipt * {
              font-weight: 700 !important;
            }

            .receipt b,
            .receipt strong,
            .receipt h1,
            .receipt h2,
            .receipt h3,
            .receipt .font-bold,
            .receipt .text-lg {
              font-weight: 900 !important;
            }

            .receipt > table,
            .receipt > div {
              border: 0 !important;
              box-shadow: none !important;
              outline: 0 !important;
            }
`;

function getReceiptPageHeightMm(receiptElement: HTMLElement) {
  const measuredHeightPx = Math.max(
    receiptElement.scrollHeight,
    receiptElement.getBoundingClientRect().height
  );

  if (!Number.isFinite(measuredHeightPx) || measuredHeightPx <= 0) {
    return RECEIPT_MIN_PAGE_HEIGHT_MM;
  }

  return Math.max(
    RECEIPT_MIN_PAGE_HEIGHT_MM,
    Math.ceil(measuredHeightPx / CSS_PIXELS_PER_MM + RECEIPT_PAGE_HEIGHT_BUFFER_MM)
  );
}

function setContinuousReceiptPageSize(printWindow: Window) {
  const receiptElement =
    printWindow.document.querySelector<HTMLElement>(".receipt");

  if (!receiptElement) return;

  const pageHeightMm = getReceiptPageHeightMm(receiptElement);
  const existingStyle = printWindow.document.querySelector(
    "style[data-receipt-page-size]"
  );
  existingStyle?.remove();

  const pageSizeStyle = printWindow.document.createElement("style");
  pageSizeStyle.setAttribute("data-receipt-page-size", "continuous");
  pageSizeStyle.textContent = `
@page {
  size: ${RECEIPT_PAGE_WIDTH_MM}mm ${pageHeightMm}mm;
  margin: 0;
}

@page :first {
  size: ${RECEIPT_PAGE_WIDTH_MM}mm ${pageHeightMm}mm;
  margin: 0;
}
`;

  printWindow.document.head.appendChild(pageSizeStyle);
}

export const usePrint = () => {
  const printReceipt = useCallback((receiptContent: string) => {
    // Create a new window for printing with specific dimensions for receipt
    const printWindow = window.open(
      "",
      "_blank",
      "width=300,height=600,scrollbars=yes"
    );

    if (!printWindow) {
      console.error(
        "Could not open print window - may be blocked by popup blocker"
      );
      // Try alternative approach - print in current window
      const printDiv = document.createElement("div");
      printDiv.style.display = "none";
      printDiv.innerHTML = `
        <style>${receiptPrintStyles}</style>
        <div class="receipt">${receiptContent}</div>
      `;
      document.body.appendChild(printDiv);

      const originalContent = document.body.innerHTML;
      document.body.innerHTML = printDiv.innerHTML;
      window.print();
      document.body.innerHTML = originalContent;

      return;
    }

    // Set up close event handler to prevent reopening
    let isClosing = false;
    let fallbackCloseTimer: ReturnType<typeof setTimeout> | undefined;

    const cancelFallbackClose = () => {
      if (fallbackCloseTimer !== undefined) {
        clearTimeout(fallbackCloseTimer);
        fallbackCloseTimer = undefined;
      }
    };

    const handleClose = () => {
      if (!isClosing) {
        isClosing = true;
        cancelFallbackClose();
      }
    };

    const closeWindow = () => {
      if (isClosing) return;
      isClosing = true;
      cancelFallbackClose();

      try {
        if (printWindow && !printWindow.closed) {
          printWindow.close();
        }
      } catch (error) {
        console.error("Error closing print window:", error);
      }
    };

    printWindow.addEventListener("beforeunload", handleClose);
    printWindow.addEventListener("unload", handleClose);

    try {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Receipt</title>
            <style>
${receiptPrintStyles}
            </style>
          </head>
          <body>
            <div class="receipt">
              ${receiptContent}
            </div>
          </body>
        </html>
      `);

      printWindow.document.close();

      // Tear the window down only once the browser says the print flow is
      // over. Closing on a fixed delay discarded the browsing context while
      // Blink was still running the print pipeline, and Chrome reports that as
      // "Failed to execute 'print' on 'Window': The provided callback is no
      // longer runnable" — raised asynchronously, so the try/catch around
      // `print()` never sees it and it lands on the terminal as an unhandled
      // rejection. `afterprint` fires once the dialog is dismissed (whether the
      // job was sent or cancelled); the long fallback only covers browsers that
      // never fire it, and must stay well clear of a dialog a cashier is still
      // reading.
      const closeAfterPrintCompletes = () => {
        const handleAfterPrint = () => {
          printWindow.removeEventListener("afterprint", handleAfterPrint);
          setTimeout(closeWindow, AFTER_PRINT_CLOSE_DELAY_MS);
        };

        printWindow.addEventListener("afterprint", handleAfterPrint);
        cancelFallbackClose();
        fallbackCloseTimer = setTimeout(closeWindow, PRINT_FALLBACK_CLOSE_MS);
      };

      // Only ever print once: the load handler and the slow-load fallback below
      // both route through here, and re-entering would both double-print and
      // print into a tearing-down window.
      let hasPrinted = false;
      const runPrint = () => {
        if (hasPrinted || isClosing) return;
        hasPrinted = true;

        try {
          if (!printWindow || printWindow.closed) {
            return;
          }

          setContinuousReceiptPageSize(printWindow);
          // Registered before `print()` because the call is modal — the
          // afterprint event can fire before it returns.
          closeAfterPrintCompletes();
          printWindow.print();
        } catch (error) {
          console.error("Error during printing:", error);
          closeWindow();
        }
      };

      // Wait for content to load, then print
      printWindow.onload = runPrint;

      // Fallback in case onload never fires. Documents built with
      // document.write can finish before the handler is attached, leaving no
      // load event to wait on.
      setTimeout(() => {
        if (
          printWindow &&
          !printWindow.closed &&
          printWindow.document.readyState !== "complete"
        ) {
          runPrint();
        }
      }, 1000);
    } catch (error) {
      console.error("Error preparing print window:", error);
      closeWindow();
    }
  }, []);

  return { printReceipt };
};
