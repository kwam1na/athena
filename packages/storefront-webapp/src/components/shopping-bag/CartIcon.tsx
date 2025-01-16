import { AnimatePresence, motion } from "framer-motion";
import { ShoppingBasket } from "lucide-react";

interface CartIconProps {
  notificationCount?: number; // Optional prop to display the count
}

const CartIcon: React.FC<CartIconProps> = ({ notificationCount }) => {
  return (
    <div className="relative inline-block">
      <ShoppingBasket className="w-5 h-5" />

      {/* Notification Dot */}
      <AnimatePresence initial={false}>
        {Boolean(notificationCount) && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute top-0 right-0 w-2 h-2 bg-accent2 rounded-full flex items-center justify-center text-xs text-white"
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default CartIcon;
