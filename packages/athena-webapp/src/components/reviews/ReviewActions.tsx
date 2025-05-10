import { Button } from "../ui/button";
import {
  CircleCheckBig,
  MessageCircleX,
  Send,
  CheckCircle2,
  XCircle,
  Undo2,
} from "lucide-react";
import { Review } from "../../../types";

interface ReviewActionsProps {
  review: Review;
  onApprove?: () => void;
  onReject?: () => void;
  onPublish?: () => void;
  onUnpublish?: () => void;
}

export function ReviewActions({
  review,
  onApprove,
  onReject,
  onPublish,
  onUnpublish,
}: ReviewActionsProps) {
  // If the review is published, show a success state with unpublish option
  if (review.isPublished) {
    return (
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-green-600">
          <CheckCircle2 className="w-4 h-4" />
          <span className="text-sm font-medium">Published</span>
        </div>
        <Button
          variant="outline"
          className="text-gray-600 hover:text-gray-700"
          onClick={onUnpublish}
        >
          <Undo2 className="w-4 h-4 mr-2" />
          Unpublish
        </Button>
      </div>
    );
  }

  // If the review is rejected, show a rejected state
  if (review.isApproved === false) {
    return (
      <div className="flex items-center gap-2 text-red-600">
        <XCircle className="w-4 h-4" />
        <span className="text-sm font-medium">Rejected</span>
      </div>
    );
  }

  // If the review is approved but not published, show approve and publish buttons
  if (review.isApproved) {
    return (
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-green-600">
          <CheckCircle2 className="w-4 h-4" />
          <span className="text-sm font-medium">Approved</span>
        </div>
        <Button variant="outline" onClick={onPublish}>
          <Send className="w-4 h-4 mr-2" />
          Publish
        </Button>
      </div>
    );
  }

  // For new reviews, show approve and reject buttons
  return (
    <div className="flex items-center gap-4">
      <Button
        variant="outline"
        className="bg-green-50 text-green-500 hover:bg-green-100 hover:text-green-600"
        onClick={onApprove}
      >
        <CircleCheckBig className="w-4 h-4 mr-2" />
        Approve
      </Button>
      <Button
        variant="outline"
        className="bg-red-50 text-red-500 hover:bg-red-100 hover:text-red-600"
        onClick={onReject}
      >
        <MessageCircleX className="w-4 h-4 mr-2" />
        Reject
      </Button>
    </div>
  );
}
