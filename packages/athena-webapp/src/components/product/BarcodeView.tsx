import { useRef } from "react";
import { useProduct } from "~/src/contexts/ProductContext";
import useGetActiveProduct from "~/src/hooks/useGetActiveProduct";
import View from "../View";
import { Button } from "../ui/button";
import { Download, Printer } from "lucide-react";
import QRCode from "react-qr-code";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import config from "~/src/config";

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

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = async () => {
    if (!qrCodeRef.current) return;

    try {
      const dataUrl = await toPng(qrCodeRef.current, {
        cacheBust: true,
        backgroundColor: "#ffffff",
      });

      const link = document.createElement("a");
      link.download = `${activeProductVariant.sku || "barcode"}-qr-code.png`;
      link.href = dataUrl;
      link.click();
      toast.success("QR code saved successfully");
    } catch (error) {
      console.error("Error downloading QR code:", error);
      toast.error("Failed to save QR code");
    }
  };

  return (
    <View hideBorder hideHeaderBottomBorder className="h-auto w-full">
      <div className="py-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Barcode</p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleDownload}>
              <Download className="w-3 h-3 mr-2" />
              Save PNG
            </Button>
            <Button size="sm" variant="outline" onClick={handlePrint}>
              <Printer className="w-3 h-3 mr-2" />
              Print
            </Button>
          </div>
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
      </div>
    </View>
  );
}
