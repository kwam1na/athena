import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

export const EmptyState = ({
  message,
  cta,
  ctaDestination,
  showButton = true,
}: {
  message: string;
  cta?: string;
  ctaDestination?: string;
  showButton?: boolean;
}) => {
  return (
    <AnimatePresence initial={false}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ease: "easeInOut" }}
        className="flex flex-col items-center mt-40 lg:items-start gap-16 lg:mt-12 h-screen"
      >
        <p className="text-lg font-light">{message}</p>
        {showButton && (
          <Link to="/shop/$categorySlug" params={{ categorySlug: "hair" }}>
            <Button variant={"clear"} className="px-0 group">
              {cta || "Continue Shopping"}
              <ArrowRight className="w-4 h-4 ml-2 -me-1 ms-2 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </Link>
        )}
      </motion.div>
    </AnimatePresence>
  );
};
