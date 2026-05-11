import { useRef } from "react";
import { useProduct } from "~/src/contexts/ProductContext";
import useGetActiveProduct from "~/src/hooks/useGetActiveProduct";
import View from "../View";
import QRCode from "react-qr-code";
import config from "~/src/config";
import { FadeIn } from "../common/FadeIn";

export function BarcodeView() {
  const { activeProductVariant } = useProduct();
  const { activeProduct } = useGetActiveProduct();
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
          className="flex flex-col items-center gap-4 p-6 bg-white rounded-lg border"
          data-print-area
        >
          <div className="bg-white p-4 rounded-lg">
            <QRCode value={productUrl} size={240} />
          </div>

          <div className="text-center space-y-2 w-full">
            <div>
              <p className="text-xs text-muted-foreground">SKU</p>
              <p className="font-mono font-semibold text-2xl">
                {activeProductVariant.sku}
              </p>
            </div>

            <div>
              <p className="text-xs text-muted-foreground">Barcode</p>
              <p className="font-mono font-semibold text-2xl">
                {activeProductVariant.barcode}
              </p>
            </div>
          </div>
        </div>
      </FadeIn>
    </View>
  );
}
