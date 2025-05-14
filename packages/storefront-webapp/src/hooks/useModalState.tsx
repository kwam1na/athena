import { useState, useEffect } from "react";

interface UseModalStateProps {
  cooldownDays?: number | null;
  lastShownKey: string;
  completedKey: string;
  dismissedKey: string;
  defaultOpen?: boolean;
}

/**
 * General purpose hook for managing modal visibility state with persistence
 * Handles cooldown, completed state, dismissed state, and state management
 */
export function useModalState({
  cooldownDays = null,
  lastShownKey,
  completedKey,
  dismissedKey,
  defaultOpen = false,
}: UseModalStateProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [hasBeenShown, setHasBeenShown] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [hasCompleted, setHasCompleted] = useState(false);
  const [lastShownTime, setLastShownTime] = useState<number | null>(null);

  useEffect(() => {
    const lastShown = localStorage.getItem(lastShownKey);
    const completed = localStorage.getItem(completedKey) === "true";
    const dismissed = localStorage.getItem(dismissedKey) === "true";
    const now = Date.now();

    // Update lastShownTime state
    if (lastShown) {
      setLastShownTime(parseInt(lastShown));
    }

    // Update dismissed state
    setIsDismissed(dismissed);

    // Update completed state
    setHasCompleted(completed);

    // If user has completed the flow, don't show modal
    if (completed) {
      setIsOpen(false);
      setHasBeenShown(true);
      return;
    }

    // If user has dismissed the modal, don't show it
    if (dismissed) {
      setIsOpen(false);
      setHasBeenShown(true);
      return;
    }

    // Check if still in cooldown period (only if cooldownDays is provided)
    if (
      cooldownDays !== null &&
      lastShown &&
      now - parseInt(lastShown) < cooldownDays * 24 * 60 * 60 * 1000
    ) {
      setIsOpen(false);
      setHasBeenShown(true);
      return;
    }

    // Otherwise, show the modal if defaultOpen is true
    if (defaultOpen) {
      setIsOpen(true);
      setHasBeenShown(true);
      // Save the current timestamp
      const currentTime = Date.now();
      setLastShownTime(currentTime);
      localStorage.setItem(lastShownKey, currentTime.toString());
    }
  }, [cooldownDays, lastShownKey, completedKey, dismissedKey, defaultOpen]);

  const handleOpen = () => {
    setIsOpen(true);
    setHasBeenShown(true);
    setIsDismissed(false);
    // Save the current timestamp
    const currentTime = Date.now();
    setLastShownTime(currentTime);
    localStorage.setItem(lastShownKey, currentTime.toString());
    localStorage.setItem(dismissedKey, "false");
  };

  const handleClose = () => {
    setIsOpen(false);
    setIsDismissed(true);
    // Save the current timestamp and mark as dismissed
    const currentTime = Date.now();
    setLastShownTime(currentTime);
    localStorage.setItem(lastShownKey, currentTime.toString());
    localStorage.setItem(dismissedKey, "true");
  };

  const handleSuccess = () => {
    setIsOpen(false);
    setHasCompleted(true);
    // Mark as completed when user completes the flow
    localStorage.setItem(completedKey, "true");
  };

  const completeFlow = () => {
    // Mark as completed when user completes the flow
    setHasCompleted(true);
    localStorage.setItem(completedKey, "true");
  };

  return {
    isOpen,
    setIsOpen,
    hasBeenShown,
    setHasBeenShown,
    isDismissed,
    setIsDismissed,
    hasCompleted,
    setHasCompleted,
    lastShownTime,
    handleOpen,
    handleClose,
    handleSuccess,
    completeFlow,
  };
}
