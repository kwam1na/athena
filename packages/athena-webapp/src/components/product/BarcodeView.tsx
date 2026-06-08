import { useRef } from "react";
import { useProduct } from "~/src/contexts/ProductContext";
import View from "../View";
import QRCode from "react-qr-code";
import config from "~/src/config";
import { FadeIn } from "../common/FadeIn";

export function BarcodeView() {
  const { activeProductVariant, activeProduct } = useProduct();
  const qrCodeRef = useRef<HTMLDivElement>(null);

  if (!activeProductVariant.barcode) {
    return null;
  }

  // Construct the storefront URL with barcode encoded in it
  // This allows the QR code to work both for customers (opening product page)
  // and for POS systems (extracting barcode from URL)
  const productUrl = `${config.storeFrontUrl}/shop/product/${activeProduct?._id}?variant=${activeProductVariant?.sku}&barcode=${activeProductVariant.barcode}`;

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      fullHeight={false}
      lockDocumentScroll={false}
      className="w-full"
    >
      <FadeIn className="py-4 space-y-4">
        <div className="flex items-center justify-between">
          {/* <p className="text-sm text-muted-foreground">Barcode</p> */}
          {/* <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleDownload}>
              <Download className="w-3 h-3 mr-2" />
              Save PNG
            </Button>
            <Button size="sm" variant="outline" onClick={handlePrint}>
              <Printer className="w-3 h-3 mr-2" />
              Print
            </Button>
          </div> */}
        </div>

        <div
          ref={qrCodeRef}
          className="flex flex-col items-center gap-4 rounded-lg border bg-white p-4 sm:p-6"
          data-print-area
        >
          <div className="rounded-lg bg-white p-2 sm:p-4">
            <QRCode
              className="h-auto w-full max-w-60"
              value={productUrl}
              size={240}
            />
          </div>

          <div className="text-center space-y-2 w-full">
            <div>
              <p className="text-xs text-muted-foreground">SKU</p>
              <p className="break-all font-mono text-lg font-semibold sm:text-2xl">
                {activeProductVariant.sku}
              </p>
            </div>

            <div>
              <p className="text-xs text-muted-foreground">Barcode</p>
              <p className="break-all font-mono text-lg font-semibold sm:text-2xl">
                {activeProductVariant.barcode}
              </p>
            </div>
          </div>
        </div>
      </FadeIn>
    </View>
  );
}
