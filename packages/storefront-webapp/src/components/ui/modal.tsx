import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import {
  Dialog,
  DialogContent,
  DialogContentNaked,
  DialogContentFullscreen,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ModalProps {
  title: string;
  description?: string;
  isOpen: boolean;
  onClose: () => void;
  children?: React.ReactNode;
  withoutHeader?: boolean;
  withoutCloseButton?: boolean;
  withoutBackground?: boolean;
  fullscreen?: boolean;
  wideOnDesktop?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  title,
  description,
  isOpen,
  onClose,
  children,
  withoutHeader,
  withoutCloseButton,
  withoutBackground,
  fullscreen,
  wideOnDesktop,
}) => {
  const onChange = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  // Use fullscreen dialog component if fullscreen prop is true
  if (fullscreen) {
    return (
      <Dialog open={isOpen} onOpenChange={onChange}>
        <DialogContentFullscreen
          className={cn(
            "bg-transparent border-none p-0",
            wideOnDesktop && "sm:max-w-[50vw]",
            withoutBackground && "bg-transparent"
          )}
        >
          <DialogTitle className="mt-6">{title}</DialogTitle>
          {children}
        </DialogContentFullscreen>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onChange}>
      {withoutCloseButton && (
        <DialogContentNaked
          className={cn(
            "bg-transparent border-none",
            withoutBackground && "bg-transparent"
          )}
        >
          {!!withoutHeader == false && (
            <DialogHeader className="flex gap-6">
              <DialogTitle className="mt-6">{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
          )}
          <div>{children}</div>
        </DialogContentNaked>
      )}
      {!withoutCloseButton && (
        <DialogContent
          className={cn(
            "bg-transparent border-none",
            withoutBackground && "bg-transparent"
          )}
        >
          {!!withoutHeader == false && (
            <DialogHeader className="flex gap-6">
              <p className="text-sm">{title}</p>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
          )}
          <VisuallyHidden.Root>
            <DialogTitle>{title}</DialogTitle>
          </VisuallyHidden.Root>

          <div>{children}</div>
        </DialogContent>
      )}
    </Dialog>
  );
};
