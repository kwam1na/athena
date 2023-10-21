'use client';

import {
   Dialog,
   DialogContent,
   DialogContentWithoutCloseButton,
   DialogDescription,
   DialogFooter,
   DialogHeader,
   DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ModalProps {
   title: string;
   description: string;
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
            <DialogContentWithoutCloseButton>
               {!!withoutHeader == false && (
                  <DialogHeader className="flex gap-6">
                     <DialogTitle className="mt-6">{title}</DialogTitle>
                     <DialogDescription>{description}</DialogDescription>
                  </DialogHeader>
               )}
               <div>{children}</div>
            </DialogContentWithoutCloseButton>
         )}
         {!withoutCloseButton && (
            <DialogContent>
               {!!withoutHeader == false && (
                  <DialogHeader className="flex gap-6">
                     <DialogTitle className="mt-6">{title}</DialogTitle>
                     <DialogDescription>{description}</DialogDescription>
                  </DialogHeader>
               )}
               <div>{children}</div>
            </DialogContent>
         )}
      </Dialog>
   );
};
