import { ChevronDown } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { postAnalytics } from "@/api/analytics";

interface ScrollDownButtonProps {
  targetRef?: React.RefObject<HTMLElement>;
  className?: string;
}

export function ScrollDownButton({
  targetRef,
  className = "",
}: ScrollDownButtonProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const handleScroll = () => {
      // Hide button when user scrolls down more than a small threshold
      if (window.scrollY > 50) {
        setIsVisible(false);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!isVisible) {
      postAnalytics({
        action: "scrolled_down_on_homepage",
      });
    }
  }, [isVisible]);

  const handleScroll = () => {
    if (targetRef?.current) {
      // Smooth scroll to target element
      targetRef.current.scrollIntoView({ behavior: "smooth" });
    } else {
      // If no target provided, scroll down a reasonable amount
      window.scrollBy({
        top: window.innerHeight * 0.75,
        behavior: "smooth",
      });
    }
  };

  if (!isVisible) return null;

  return (
    <motion.button
      //   onClick={handleScroll}
      className={`flex flex-col items-center justify-center cursor-pointer ${className}`}
      initial={{ opacity: 0, y: -10 }}
      animate={{
        opacity: [0.4, 0.8, 0.4],
        y: [0, 8, 0],
      }}
      transition={{
        duration: 1.5,
        repeat: Infinity,
        ease: "easeInOut",
        repeatType: "loop",
      }}
      aria-label="Scroll down"
    >
      {/* <span className="text-sm font-medium text-white/70 mb-1">
        See why we're rated the #1 shop for all your hair needs
      </span> */}
      <div className="bg-white/20 backdrop-blur-sm rounded-full p-1.5">
        <ChevronDown className="h-5 w-5 text-white" />
      </div>
    </motion.button>
  );
}
