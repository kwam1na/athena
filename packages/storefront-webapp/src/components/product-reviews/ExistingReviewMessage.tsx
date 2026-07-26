import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { format } from "date-fns";
import { InlineAlert } from "../ui/inline-alert";

interface ExistingReviewMessageProps {
  creationTime: number;
  orderId: string;
}

export const ExistingReviewMessage = ({
  creationTime,
  orderId,
}: ExistingReviewMessageProps) => (
  <motion.div
    initial={{ opacity: 0, y: 2 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{
      duration: 1.2,
      ease: [0.16, 1, 0.3, 1],
      opacity: { duration: 0.7 },
    }}
    className="space-y-6"
  >
    <InlineAlert tone="info" title="You've already reviewed this product">
      <p className="text-sm pl-7">
        You submitted your review on {format(creationTime, "MMMM d, yyyy")}.
      </p>
    </InlineAlert>

    <motion.div
      className="flex flex-col sm:flex-row gap-4"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.4,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      <Button variant="outline" className="flex items-center gap-2" asChild>
        <Link to="/shop/orders/$orderId" params={{ orderId }}>
          <ArrowLeft className="w-4 h-4" />
          Back to order
        </Link>
      </Button>
      <Button className="flex items-center gap-2" asChild>
        <Link to="/">Continue Shopping</Link>
      </Button>
    </motion.div>
  </motion.div>
);
