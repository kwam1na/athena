import { AnimatePresence, motion } from "framer-motion";

interface CartIconProps {
  notificationCount?: number;
  hoverClass?: string;
}

const CartIcon: React.FC<CartIconProps> = ({
  notificationCount,
  hoverClass,
}) => {
  return (
    <div className="relative inline-block">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 512 526"
        fill="none"
        stroke="currentColor"
        strokeWidth="40"
        className={`w-4 h-4 ${hoverClass}`}
      >
        <path d="M80 160a40 40 0 0 1 40-40h272a40 40 0 0 1 40 40l24 184a72 72 0 0 1-72 80H128a72 72 0 0 1-72-80l24-184z" />
        <path d="M176 160v-64a80 80 0 1 1 160 0v64" />
      </svg>

      {/* Notification Dot */}
      <AnimatePresence>
        {Boolean(notificationCount) && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute top-0 right-0 w-1.5 h-1.5 bg-accent2 rounded-full flex items-center justify-center text-xs text-white"
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default CartIcon;
