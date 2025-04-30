import { ProductSku } from "@athena/webapp";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { capitalizeWords } from "@/lib/utils";
import { getProductName } from "@/lib/productUtils";

interface UpsellProps {
  product: ProductSku;
  isOpen: boolean;
  onClose: () => void;
}

export function Upsell({ product, isOpen, onClose }: UpsellProps) {
  const { formatter } = useStoreContext();

  if (!product) return null;

  const productName = getProductName(product);
  const isLowStock =
    product.quantityAvailable > 0 && product.quantityAvailable <= 2;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Don't miss out!</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex flex-col space-y-4">
            <div className="overflow-hidden relative">
              <img
                alt={`${productName} image`}
                className="w-full h-[300px] object-cover rounded"
                src={product.images[0]}
              />
              {isLowStock && (
                <div className="font-medium text-xs absolute top-0 left-0 m-2 text-white bg-black bg-opacity-40 rounded-md px-2 py-1">
                  🔥 Only {product.quantityAvailable} left
                </div>
              )}
            </div>
            <div className="flex flex-col items-start space-y-2">
              <p className="font-medium">{productName}</p>
              <p className="text-sm">{formatter.format(product.price)}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                This caught your eye last time. Ready to make it yours?
              </p>
              {isLowStock && (
                <p className="text-sm text-red-500">
                  Hurry! Only {product.quantityAvailable} left in stock
                </p>
              )}
            </div>
            <div className="flex gap-4">
              <Button variant="outline" onClick={onClose}>
                Maybe Later
              </Button>
              <Button className="bg-[#EC4683] hover:bg-[#EC4683]/90">
                Add to Bag
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
