import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import {
  Dialog,
  DialogContent,
  DialogContentNaked,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ModalProps {
  title: string;
  description?: string;
  isOpen: boolean;
  onClose: () => void;
  children?: React.ReactNode;
  withoutHeader?: boolean;
  withoutCloseButton?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  title,
  description,
  isOpen,
  onClose,
  children,
  withoutHeader,
  withoutCloseButton,
}) => {
  const onChange = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onChange}>
      {withoutCloseButton && (
        <DialogContentNaked>
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
        <DialogContent>
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
