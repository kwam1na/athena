import React from "react";
import QRCode from "react-qr-code";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { Button } from "../ui/button";
import { Printer } from "lucide-react";
import config from "~/src/config";

interface BarcodeQRViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  barcode: string;
  sku: string;
  productName?: string;
  productId?: string;
}

export function BarcodeQRViewer({
  open,
  onOpenChange,
  barcode,
  sku,
  productName,
  productId,
}: BarcodeQRViewerProps) {
  const handlePrint = () => {
    window.print();
  };

  // Construct the storefront URL with barcode encoded in it
  // This allows the QR code to work both for customers (opening product page)
  // and for POS systems (extracting barcode from URL)
  const productUrl = productId
    ? `${config.storeFrontUrl}/shop/product/${productId}?variant=${sku}&barcode=${barcode}`
    : barcode;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle>Product Barcode</SheetTitle>
          <SheetDescription>
            Scan this QR code to access the product or use in POS
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col items-center gap-6 py-8" data-print-area>
          <div className="bg-white p-6 rounded-lg border-2 border-gray-200">
            <QRCode value={productUrl} size={256} />
          </div>

          <div className="text-center space-y-4 w-full">
            <div>
              <p className="text-sm text-muted-foreground">SKU</p>
              <p className="font-mono font-semibold text-lg">{sku}</p>
            </div>

            <div>
              <p className="text-sm text-muted-foreground">Barcode</p>
              <p className="font-mono font-semibold text-lg">{barcode}</p>
            </div>

            {productName && (
              <div>
                <p className="text-sm text-muted-foreground">Product</p>
                <p className="font-semibold">{productName}</p>
              </div>
            )}
          </div>

          <Button onClick={handlePrint} className="w-full" size="lg">
            <Printer className="w-4 h-4 mr-2" />
            Print Barcode Label
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
