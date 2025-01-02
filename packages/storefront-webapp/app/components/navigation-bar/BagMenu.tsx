import { useShoppingBag } from "@/hooks/useShoppingBag";
import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import SavedIcon from "../saved-items/SavedIcon";
import placeholder from "@/assets/placeholder.png";
import { getProductName } from "@/lib/productUtils";
import { Button } from "../ui/button";
import { Cog, Package } from "lucide-react";
import { PersonIcon } from "@radix-ui/react-icons";

export const BagMenu = ({
  setActiveMenu,
  onCloseClick,
}: {
  setActiveMenu: (menu: string | null) => void;
  onCloseClick?: () => void;
}) => {
  const item = {
    hidden: { y: -2, opacity: 0 },
    show: { y: 0, opacity: 1 },
    exit: { y: 0, opacity: 0 },
  };

  const { bag, savedBagCount } = useShoppingBag();

  const handleOnLinkClick = () => {
    onCloseClick && onCloseClick();
    setActiveMenu(null);
  };

  return (
    <motion.div variants={item} className="space-y-12 pb-16">
      {bag.items?.length > 0 && (
        <div className="space-y-8">
          <p className="text-lg">Bag</p>

          <div className="flex flex-col gap-8 lg:flex-row">
            <div className="grid grid-cols-1 gap-8 px-4">
              {bag?.items.slice(0, 3).map((item: any, idx: number) => (
                <Link
                  to="/shop/product/$productSlug"
                  params={() => ({ productSlug: item.productId })}
                  search={{
                    variant: item.productSku,
                  }}
                  onClick={handleOnLinkClick}
                  key={idx}
                  className="flex items-center gap-4"
                >
                  <img
                    src={item.productImage || placeholder}
                    alt={item.productName || "product image"}
                    className="w-16 h-16 aspect-square object-cover rounded-lg"
                  />
                  <p className="text-sm">{getProductName(item)}</p>
                </Link>
              ))}

              {bag?.items.length > 3 && (
                <p className="text-xs text-muted-foreground">
                  {`${bag.items.length - 3} more ${bag.items.length - 3 === 1 ? "item" : "items"} in your bag`}
                </p>
              )}
            </div>

            <Link
              className="w-full lg:w-auto lg:ml-auto"
              to="/shop/bag"
              onClick={handleOnLinkClick}
            >
              <Button className="w-full" variant={"outline"}>
                <p>View Bag</p>
              </Button>
            </Link>
          </div>
        </div>
      )}

      {bag.items?.length == 0 && (
        <p className="text-lg font-medium">Your bag is empty.</p>
      )}

      <div className="space-y-4 max-w-[180px]">
        <Link
          to="/shop/orders"
          className="flex items-center gap-4"
          onClick={handleOnLinkClick}
        >
          <Package className="w-4 h-4" />
          <p className="text-sm">Orders</p>
        </Link>

        <Link
          to="/shop/saved"
          className="flex items-center gap-4"
          onClick={handleOnLinkClick}
        >
          <SavedIcon notificationCount={savedBagCount} />
          <p className="text-sm">Saved</p>
        </Link>

        <Link
          to="/shop/saved"
          className="flex items-center gap-4"
          onClick={handleOnLinkClick}
        >
          <Cog className="w-4 h-4" />
          <p className="text-sm">Account</p>
        </Link>

        <Link
          to="/shop/saved"
          className="flex items-center gap-4"
          onClick={handleOnLinkClick}
        >
          <PersonIcon className="w-4 h-4" />
          <p className="text-sm">Sign in</p>
        </Link>
      </div>
    </motion.div>
  );
};
