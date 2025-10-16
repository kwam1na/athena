import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

export const TrustSignals = () => {
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);

  const messages = [
    {
      id: "payment-delivery",
      content: (
        <p className="text-sm">
          <b className="text-accent2">Payment on delivery</b> available on
          orders within Accra
        </p>
      ),
    },
    {
      id: "trusted",
      content: (
        <p className="text-sm">
          <b className="text-accent2">Trusted by over 63k shoppers</b> in Ghana
          & beyond!
        </p>
      ),
    },
    {
      id: "returns",
      content: (
        <p className="text-sm">
          <b className="text-accent2">Shop risk-free</b> with our 7-day money
          back guarantee
        </p>
      ),
    },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentMessageIndex((prev) => (prev + 1) % messages.length);
    }, 4000);

    return () => clearInterval(interval);
  }, [messages.length]);

  return (
    <div className="rounded-md w-fit min-h-[3rem] flex items-center">
      <AnimatePresence mode="wait">
        <motion.div
          key={messages[currentMessageIndex].id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{
            duration: 0.47,
            ease: "easeInOut",
            delay: 0.9,
          }}
          className="space-y-2"
        >
          {messages[currentMessageIndex].content}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
