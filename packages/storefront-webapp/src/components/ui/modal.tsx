import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface ModalProps {
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

  return (
    <Dialog open={isOpen} onOpenChange={onChange}>
      <DialogContent
        presentation={
          fullscreen ? "fullscreen" : withoutBackground ? "naked" : "default"
        }
        showCloseButton={!withoutCloseButton}
        className={cn(
          fullscreen && "p-0",
          wideOnDesktop && "sm:max-w-4xl",
        )}
      >
        {!withoutHeader ? (
          <DialogHeader className="flex gap-2">
            <DialogTitle>{title}</DialogTitle>
            {description && (
              <DialogDescription>{description}</DialogDescription>
            )}
          </DialogHeader>
        ) : (
          <VisuallyHidden.Root>
            <DialogTitle>{title}</DialogTitle>
            {description && (
              <DialogDescription>{description}</DialogDescription>
            )}
          </VisuallyHidden.Root>
        )}
        <div>{children}</div>
      </DialogContent>
    </Dialog>
  );
};
