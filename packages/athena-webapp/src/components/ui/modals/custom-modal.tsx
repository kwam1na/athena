import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogContentNaked,
  DialogOverlay,
} from "@/components/ui/dialog";

interface CustomModalProps {
  isOpen: boolean;
  onClose: () => void;
  header?: React.ReactNode;
  body?: React.ReactNode;
  footer?: React.ReactNode;
  closeButton?: React.ReactNode;
  overlay?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  hideCloseButton?: boolean;
  centered?: boolean;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  position?: "center" | "top" | "bottom" | "left" | "right";
}

export const CustomModal: React.FC<CustomModalProps> = ({
  isOpen,
  onClose,
  header,
  body,
  footer,
  closeButton,
  overlay,
  className,
  contentClassName,
  hideCloseButton = false,
  centered = true,
  size = "md",
  position = "center",
}) => {
  const [isMounted, setIsMounted] = React.useState(false);

  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return null;
  }

  // Determine max width based on size prop
  const sizeClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    full: "max-w-full mx-4",
  };

  // Determine position classes
  const positionClasses = {
    center: "left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%]",
    top: "left-[50%] top-4 translate-x-[-50%] translate-y-0",
    bottom: "left-[50%] bottom-4 translate-x-[-50%] translate-y-0",
    left: "left-4 top-[50%] translate-x-0 translate-y-[-50%]",
    right: "right-4 top-[50%] translate-x-0 translate-y-[-50%]",
  };

  const onChange = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  const CustomDialogContent = hideCloseButton
    ? DialogContentNaked
    : DialogContent;

  return (
    <Dialog open={isOpen} onOpenChange={onChange}>
      {overlay || <DialogOverlay />}
      <CustomDialogContent
        className={`fixed z-50 grid w-full gap-4 border bg-background p-6 shadow-lg duration-200 
        data-[state=open]:animate-in data-[state=closed]:animate-out 
        data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 
        data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 
        data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] 
        data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] 
        sm:rounded-lg ${sizeClasses[size]} ${positionClasses[position]} ${contentClassName}`}
      >
        {header && <div className="mb-4">{header}</div>}
        {body && <div className="my-2">{body}</div>}
        {footer && <div className="mt-4">{footer}</div>}
        {!hideCloseButton && closeButton}
      </CustomDialogContent>
    </Dialog>
  );
};
