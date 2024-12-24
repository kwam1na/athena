import { motion } from "framer-motion";

export const FadeIn = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{
        opacity: 1,
        transition: { ease: "easeOut", duration: 0.2 },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
};
