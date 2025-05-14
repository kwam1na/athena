import { useModalState } from "./useModalState";

const REWARDS_ALERT_LAST_SHOWN_KEY = "rewards_alert_last_shown";
const REWARDS_ALERT_COMPLETED_KEY = "rewards_alert_completed";
const REWARDS_ALERT_DISMISSED_KEY = "rewards_alert_dismissed";

/**
 * Custom hook to handle rewards alert logic
 * Uses the generic useModalState hook for state management
 */
export function useRewardsAlert() {
  const {
    isOpen,
    setIsOpen,
    hasBeenShown,
    setHasBeenShown,
    isDismissed,
    setIsDismissed,
    lastShownTime,
    handleOpen,
    handleClose,
    handleSuccess,
    completeFlow,
    hasCompleted,
  } = useModalState({
    lastShownKey: REWARDS_ALERT_LAST_SHOWN_KEY,
    completedKey: REWARDS_ALERT_COMPLETED_KEY,
    dismissedKey: REWARDS_ALERT_DISMISSED_KEY,
    defaultOpen: true,
  });

  return {
    isRewardsAlertOpen: isOpen,
    setIsRewardsAlertOpen: setIsOpen,
    hasRewardsAlertBeenShown: hasBeenShown,
    setHasRewardsAlertBeenShown: setHasBeenShown,
    isRewardsAlertDismissed: isDismissed,
    setIsRewardsAlertDismissed: setIsDismissed,
    lastRewardsAlertShownTime: lastShownTime,
    openRewardsAlert: handleOpen,
    handleCloseRewardsAlert: handleClose,
    handleSuccessRewardsAlert: handleSuccess,
    completeRewardsAlertFlow: completeFlow,
    hasCompletedRewardsAlertFlow: hasCompleted,
  };
}
