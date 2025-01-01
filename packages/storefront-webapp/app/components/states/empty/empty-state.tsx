import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";

export const EmptyState = ({ message }: { message: string }) => {
  return (
    <AnimatePresence initial={false}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ease: "easeInOut" }}
        className="flex flex-col items-center mt-40 lg:items-start gap-16 lg:mt-12 h-screen"
      >
        <p className="text-lg font-medium">{message}</p>
        <Link to="/">
          <Button className="w-[320px]">Continue Shopping</Button>
        </Link>
      </motion.div>
    </AnimatePresence>
  );
};
