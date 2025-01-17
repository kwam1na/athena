import { ProductSku } from "@athena/webapp";
import { motion } from "framer-motion";

type BagItemProps = {
  item: any; // The product item object
  actionIcons: {
    delete: JSX.Element; // Icon for delete action
    move: JSX.Element; // Icon for move action
    secondary: JSX.Element; // Icon for secondary action
  };
  onPrimaryAction: (data: { quantity: number; itemId: number }) => void; // Function to handle primary action
  onSecondaryAction: (item: ProductSku) => void; // Function to handle secondary action
  isUpdating: boolean; // Whether the bag is being updated
  formatter: Intl.NumberFormat; // Function to format currency or numbers
  bagAction: string; // The current bag action (e.g., 'delete', 'move')
};

export function BagItem({
  item,
  actionIcons,
  onPrimaryAction,
  onSecondaryAction,
  isUpdating,
  formatter,
  bagAction,
}: BagItemProps) {
  const cellVariants = {
    exit: (bagAction: string) => ({
      opacity: 0,
      x: bagAction === "delete" ? 0 : 24,
    }),
  };

  const backgroundSvgVariants = {
    exit: (bagAction: string) => ({
      opacity: 0,
      x: bagAction === "delete" ? 0 : 24,
    }),
  };

  return (
    <motion.div layout className="relative flex items-center space-x-4">
      <motion.div
        className="absolute inset-0 flex px-16 items-center pointer-events-none"
        variants={backgroundSvgVariants}
        exit="exit"
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        {bagAction === "delete" ? actionIcons.delete : actionIcons.move}
      </motion.div>

      <motion.div
        variants={cellVariants}
        exit="exit"
        className="relative z-10 flex gap-4 items-center"
      >
        <img
          src={item.productImage || ""}
          alt={item.productName || "product image"}
          className="w-48 h-48 object-cover rounded-lg"
        />
        <div className="flex-1 space-y-6">
          <div className="flex flex-col ml-2 gap-2">
            <h2>{item.productName}</h2>
            <p className="text-sm text-muted-foreground">
              {item.price
                ? formatter.format(item.price * item.quantity)
                : "Product unavailable"}
            </p>
            <select
              value={item.quantity}
              onChange={(e) =>
                onPrimaryAction({
                  quantity: parseInt(e.target.value),
                  itemId: item._id,
                })
              }
              disabled={isUpdating || !item.price}
              className="w-12 py-2 bg-white text-black"
            >
              {[...Array(10)].map((_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onSecondaryAction(item)}
              disabled={isUpdating || !item.price}
            >
              {actionIcons.secondary}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
