import { Variants } from "framer-motion";

// Define animation variants with easing
export const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      delay: 0.2,
      duration: 0.8, // Increased from 0.5
      ease: [0.22, 1, 0.36, 1], // Custom cubic-bezier curve (ease-out-quint)
    },
  },
};

export const backgroundVariants: Variants = {
  hidden: { scale: 1.1, opacity: 0 },
  visible: {
    scale: 1,
    opacity: 1,
    transition: {
      duration: 1.4, // Increased from 0.9
      ease: [0.16, 1, 0.3, 1], // Custom bezier curve for a smooth entrance
    },
  },
};

export const overlayVariants: Variants = {
  hidden: { backdropFilter: "blur(0px)", backgroundColor: "rgba(0, 0, 0, 0)" },
  visible: {
    backdropFilter: "blur(4px)",
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    transition: {
      duration: 1.2, // Increased from 0.8
      ease: "easeInOut",
    },
  },
};

// Combined content animation for all text elements at once
export const contentVariants: Variants = {
  hidden: {
    y: 0,
    opacity: 0,
  },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      duration: 0.9,
      delay: 0.2, // Delay content until background and overlay effects are well underway
      ease: [0.25, 1, 0.5, 1], // Custom curve for a smooth, slightly bouncy entrance
    },
  },
};

// Success animation variants
export const successVariants: Variants = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
    transition: {
      duration: 0.8,
      ease: [0.34, 1.56, 0.64, 1], // Custom spring-like curve for a celebratory bounce effect
    },
  },
};

// Check icon animation
export const checkIconVariants: Variants = {
  hidden: {
    scale: 0.8,
    opacity: 0,
  },
  visible: {
    scale: 1,
    opacity: 1,
    transition: {
      duration: 0.4,
      delay: 0.1,
      ease: [0.34, 1.56, 0.64, 1], // Bouncy effect for the check icon
    },
  },
};
