import { useEffect, useState } from "react";

export const useCountdown = (targetTimestamp: number | undefined) => {
  const [timeLeft, setTimeLeft] = useState<string | null>(null);

  useEffect(() => {
    if (!targetTimestamp) {
      setTimeLeft(null);
      return;
    }

    const updateCountdown = () => {
      const now = Date.now();
      const remaining = targetTimestamp - now;

      if (remaining <= 0) {
        setTimeLeft(null);
        return;
      }

      const seconds = Math.floor(remaining / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      // Smart formatting: show only relevant units, always include seconds
      if (days > 0) {
        const remainingHours = hours % 24;
        const remainingMinutes = minutes % 60;
        setTimeLeft(`${days}d ${remainingHours}h ${remainingMinutes}m`);
      } else if (hours > 0) {
        const remainingMinutes = minutes % 60;
        const remainingSeconds = seconds % 60;
        setTimeLeft(`${hours}h ${remainingMinutes}m ${remainingSeconds}s`);
      } else if (minutes > 0) {
        const remainingSeconds = seconds % 60;
        setTimeLeft(`${minutes}m ${remainingSeconds}s`);
      } else {
        setTimeLeft(`${seconds}s`);
      }
    };

    // Initial update
    updateCountdown();

    // Update every second
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [targetTimestamp]);

  return { timeLeft };
};
