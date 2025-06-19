import { useCallback } from "react";

export const usePrint = () => {
  const printReceipt = useCallback((receiptContent: string) => {
    console.log(
      "printReceipt called with content length:",
      receiptContent.length
    );

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
        <div class="receipt" style="font-family: 'Courier New', monospace; font-size: 12px; line-height: 1.3; color: #000; background: #fff; padding: 5mm; max-width: 80mm; margin: 0 auto; width: 100%;">
          ${receiptContent}
        </div>
      `;
      document.body.appendChild(printDiv);

      const originalContent = document.body.innerHTML;
      document.body.innerHTML = printDiv.innerHTML;
      window.print();
      document.body.innerHTML = originalContent;

      return;
    }

    console.log("Print window opened successfully");

    // Set up close event handler to prevent reopening
    let isClosing = false;
    const handleClose = () => {
      if (!isClosing) {
        isClosing = true;
        console.log("Print window closing event triggered");
      }
    };

    printWindow.addEventListener("beforeunload", handleClose);
    printWindow.addEventListener("unload", handleClose);

    // Write the receipt HTML to the new window
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Receipt</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            
                         body {
               font-family: 'Courier New', monospace;
               font-size: 12px;
               line-height: 1.3;
               color: #000;
               background: #fff;
               padding: 5mm;
               -webkit-print-color-adjust: exact;
               print-color-adjust: exact;
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
              font-size: 10px;
            }
            
            .text-sm {
              font-size: 11px;
            }
            
            .text-base {
              font-size: 12px;
            }
            
            .text-lg {
              font-size: 14px;
            }
            
            .font-bold {
              font-weight: bold;
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
              border-bottom: 1px dashed #000;
            }
            
            .border-t {
              border-top: 1px solid #000;
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
               size: 80mm auto;
               margin: 0;
             }
             
             /* Fallback for browsers that don't support custom page sizes */
             @page :first {
               size: 80mm auto;
               margin: 0;
             }
            
            @media print {
              body {
                padding: 0;
                margin: 0;
                width: 80mm;
                font-size: 10px;
              }
              
              .receipt {
                max-width: none;
                width: 100%;
                margin: 0;
                padding: 5mm;
              }
              
              .text-lg {
                font-size: 12px;
              }
              
              .text-base {
                font-size: 10px;
              }
              
              .text-sm {
                font-size: 9px;
              }
              
                             .text-xs {
                 font-size: 8px;
               }
               
               .border-b {
                 border-bottom: 1px dashed #000 !important;
               }
               
               .border-t {
                 border-top: 1px solid #000 !important;
               }
               
               .font-bold {
                 font-weight: bold !important;
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

    // Wait for content to load, then print
    printWindow.onload = () => {
      console.log("Print window loaded, calling print()");
      try {
        printWindow.print();
        console.log("Print dialog should be open now");

        // Close the window after a brief delay to allow print dialog to process
        setTimeout(() => {
          if (printWindow && !printWindow.closed && !isClosing) {
            isClosing = true;
            printWindow.close();
            console.log("Print window closed via timeout");
          }
        }, 1500);
      } catch (error) {
        console.error("Error during printing:", error);
        // Close window even if printing fails
        setTimeout(() => {
          if (printWindow && !printWindow.closed && !isClosing) {
            isClosing = true;
            printWindow.close();
          }
        }, 500);
      }
    };

    // Fallback in case onload doesn't fire (but don't duplicate print call)
    setTimeout(() => {
      if (
        printWindow &&
        !printWindow.closed &&
        printWindow.document.readyState !== "complete"
      ) {
        console.log(
          "Fallback: window still loading, triggering onload manually"
        );
        if (printWindow.onload) {
          (printWindow.onload as () => void)();
        }
      }
    }, 1000);
  }, []);

  return { printReceipt };
};
