import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface VoidSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => Promise<void>;
}

export function VoidSessionDialog({
  open,
  onOpenChange,
  onConfirm,
}: VoidSessionDialogProps) {
  const [voidReason, setVoidReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirm = async () => {
    // if (!voidReason.trim()) return;

    setIsSubmitting(true);
    try {
      await onConfirm(voidReason);
      setVoidReason(""); // Clear on success
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setVoidReason("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void Session</DialogTitle>
          <DialogDescription>
            This will delete the held session. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* <div>
            <Label htmlFor="voidReason">Reason (required)</Label>
            <Textarea
              id="voidReason"
              placeholder="Why is this session being voided?"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              disabled={isSubmitting}
              required
            />
          </div> */}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Voiding..." : "Void Session"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
