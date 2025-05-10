import { motion } from "framer-motion";
import { CheckCircle2, ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "../ui/button";

interface SuccessMessageProps {
  orderId: string;
}

export const SuccessMessage = ({ orderId }: SuccessMessageProps) => (
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
    <motion.div
      className="space-y-3 text-green-700 bg-green-50 p-6 rounded-lg"
      animate={{ scale: 1 }}
      transition={{
        duration: 0.8,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-5 h-5" />
        <h3 className="font-medium">Thank you for your review!</h3>
      </div>
      <p className="text-sm pl-7">
        Your feedback has been received and will show up on the product page
        shortly.
      </p>
    </motion.div>

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
