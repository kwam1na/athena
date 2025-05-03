import { useState, useEffect, RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { useUpsellsQueries } from "@/lib/queries/upsells";

/**
 * Custom hook to handle product reminder logic
 * Manages state for when to show the product reminder bar
 */
export function useProductReminder(homeHeroRef: RefObject<HTMLDivElement>) {
  const [showReminderBar, setShowReminderBar] = useState(false);
  const upsellsQueries = useUpsellsQueries();
  const { data: upsell } = useQuery(upsellsQueries.upsells());

  useEffect(() => {
    const checkScroll = () => {
      if (homeHeroRef.current) {
        const heroBottom = homeHeroRef.current.getBoundingClientRect().top;
        const windowHeight = window.innerHeight;

        if (heroBottom < windowHeight / 2) {
          setShowReminderBar(true);
          window.removeEventListener("scroll", checkScroll);
        }
      }
    };

    window.addEventListener("scroll", checkScroll);
    return () => window.removeEventListener("scroll", checkScroll);
  }, [homeHeroRef]);

  return {
    showReminderBar,
    setShowReminderBar,
    upsell,
  };
}
