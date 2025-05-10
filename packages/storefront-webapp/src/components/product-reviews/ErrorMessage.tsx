import { motion } from "framer-motion";
import { AlertCircle } from "lucide-react";

interface ErrorMessageProps {
  message: string;
}

export const ErrorMessage = ({ message }: ErrorMessageProps) => (
  <motion.div
    initial={{ opacity: 0, x: -4 }}
    animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0, x: -4 }}
    className="flex items-center gap-2 text-sm px-3 py-2 rounded-md text-red-700 bg-red-50"
  >
    <AlertCircle className="w-4 h-4" />
    <span>{message}</span>
  </motion.div>
);
