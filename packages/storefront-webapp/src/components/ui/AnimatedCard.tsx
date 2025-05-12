import { ReactNode, forwardRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface AnimatedCardProps {
  children: ReactNode;
  isOpen: boolean;
  className?: string;
}

const AnimatedCard = forwardRef<HTMLDivElement, AnimatedCardProps>(
  ({ children, isOpen, className }, ref) => {
    return (
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={ref}
            initial={{ opacity: 0, y: -50 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: {
                duration: 0.8,
                delay: 2.8,
                ease: [0.22, 1, 0.36, 1],
              },
            }}
            exit={{
              opacity: 0,
              y: -50,
              transition: {
                duration: 0.4,
                ease: [0.4, 0, 1, 1],
              },
            }}
            className={className}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    );
  }
);

AnimatedCard.displayName = "AnimatedCard";

export { AnimatedCard };
export type { AnimatedCardProps };
