import { useEffect, useState } from "react";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "../loading-button";

interface AlertModalProps {
  ctaText?: string;
  description?: string;
  isOpen: boolean;
  loading: boolean;
  secondaryLoading?: boolean;
  secondaryCtaText?: string;
  title?: string;
  onClose: () => void;
  onConfirm: () => void;
  onSecondaryConfirm?: () => void;
}

export const AlertModal: React.FC<AlertModalProps> = ({
  ctaText,
  isOpen,
  title,
  description,
  loading,
  onClose,
  onConfirm,
  onSecondaryConfirm,
  secondaryLoading,
  secondaryCtaText,
}) => {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return null;
  }

  return (
    <Modal
      title={title || "Are you sure?"}
      description={description}
      isOpen={isOpen}
      onClose={!loading ? onClose : () => {}}
    >
      <div className="pt-6 space-x-2 flex items-center justify-end w-full">
        <Button disabled={loading} variant="outline" onClick={onClose}>
          Cancel
        </Button>
        {onSecondaryConfirm && (
          <LoadingButton
            isLoading={!!secondaryLoading}
            disabled={secondaryLoading}
            onClick={onSecondaryConfirm}
          >
            {secondaryCtaText || "Continue"}
          </LoadingButton>
        )}
        <LoadingButton
          isLoading={loading}
          disabled={loading}
          onClick={onConfirm}
        >
          {ctaText || "Continue"}
        </LoadingButton>
      </div>
    </Modal>
  );
};
