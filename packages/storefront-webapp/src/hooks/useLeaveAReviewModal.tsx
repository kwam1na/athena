import { useModalState } from "./useModalState";
import { useQuery } from "@tanstack/react-query";
import { useOnlineOrderQueries } from "@/lib/queries/onlineOrder";
import { useReviewQueries } from "@/lib/queries/reviews";
import { useStoreContext } from "@/contexts/StoreContext";

const LEAVE_REVIEW_COOLDOWN_DAYS = 7;
const LEAVE_REVIEW_LAST_SHOWN_KEY = "leave_review_modal_last_shown";
const LEAVE_REVIEW_COMPLETED_KEY = "leave_review_modal_completed";
const LEAVE_REVIEW_DISMISSED_KEY = "leave_review_modal_dismissed";

/**
 * Custom hook to handle leave a review modal logic
 * Uses the generic useModalState hook for state management and checks eligibility
 */
export function useLeaveAReviewModal() {
  const { store } = useStoreContext();
  const onlineOrderQueries = useOnlineOrderQueries();
  const { data: onlineOrders } = useQuery(onlineOrderQueries.list());
  const { hasUserReviewForOrderItem } = useReviewQueries();

  // Get the most recent order
  const orderToReview = onlineOrders?.[onlineOrders.length - 1];
  const itemToReview = orderToReview?.items?.[0];

  // Check if user already reviewed this item
  const { data: hasReviewed } = useQuery(
    hasUserReviewForOrderItem((itemToReview as any)?._id)
  );

  // Check if order can be reviewed
  const canReview = ["delivered", "picked-up"].includes(
    orderToReview?.status || ""
  );

  // Check if store has promo code configured
  const hasPromoCode = Boolean(
    store?.config?.leaveAReviewDiscountCodeModalPromoCode
  );

  // Determine if all conditions are met to show modal
  const canShowModal =
    Boolean(orderToReview) &&
    Boolean(itemToReview) &&
    canReview &&
    !hasReviewed &&
    hasReviewed !== undefined &&
    hasPromoCode;

  const {
    isOpen,
    setIsOpen,
    hasBeenShown,
    setHasBeenShown,
    isDismissed,
    setIsDismissed,
    lastShownTime,
    isLoaded,
    handleOpen,
    handleClose,
    handleSuccess,
    completeFlow,
    hasCompleted,
  } = useModalState({
    cooldownDays: LEAVE_REVIEW_COOLDOWN_DAYS,
    lastShownKey: LEAVE_REVIEW_LAST_SHOWN_KEY,
    completedKey: LEAVE_REVIEW_COMPLETED_KEY,
    dismissedKey: LEAVE_REVIEW_DISMISSED_KEY,
    defaultOpen: canShowModal,
  });

  return {
    isLeaveReviewModalOpen: isOpen,
    setIsLeaveReviewModalOpen: setIsOpen,
    hasLeaveReviewModalBeenShown: hasBeenShown,
    setHasLeaveReviewModalBeenShown: setHasBeenShown,
    isLeaveReviewModalDismissed: isDismissed,
    setIsLeaveReviewModalDismissed: setIsDismissed,
    lastLeaveReviewModalShownTime: lastShownTime,
    isLeaveReviewModalStateLoaded: isLoaded,
    openLeaveReviewModal: handleOpen,
    handleCloseLeaveReviewModal: handleClose,
    handleSuccessLeaveReviewModal: handleSuccess,
    completeLeaveReviewModalFlow: completeFlow,
    hasCompletedLeaveReviewModalFlow: hasCompleted,
    orderToReview,
    itemToReview,
    canShowModal,
  };
}
