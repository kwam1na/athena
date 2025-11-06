import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface HoldSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason?: string) => Promise<void>;
}

export function HoldSessionDialog({
  open,
  onOpenChange,
  onConfirm,
}: HoldSessionDialogProps) {
  const [holdReason, setHoldReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      await onConfirm(holdReason || undefined);
      setHoldReason(""); // Clear on success
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setHoldReason("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hold Current Session</DialogTitle>
          <DialogDescription>
            This will save your current cart and customer information so you can
            return to it later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="holdReason">Reason (optional)</Label>
            <Input
              id="holdReason"
              placeholder="Customer stepped away, phone call, etc."
              value={holdReason}
              onChange={(e) => setHoldReason(e.target.value)}
              disabled={isSubmitting}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={isSubmitting}>
              {isSubmitting ? "Holding..." : "Hold Session"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
