'use client';

import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

interface ActionModalProps {
   isOpen: boolean;
   title: string;
   description: string;
   onClose: () => void;
   onConfirm: () => void;
   loading: boolean;
   children?: React.ReactNode;
}

export const ActionModal: React.FC<ActionModalProps> = ({
   isOpen,
   title,
   description,
   onClose,
   onConfirm,
   loading,
   children,
}) => {
   return (
      <Modal
         title={title}
         description={description}
         isOpen={isOpen}
         onClose={onClose}
      >
         <div>{children}</div>
         <div className="pt-6 space-x-2 flex items-center justify-end w-full">
            <Button disabled={loading} variant="outline" onClick={onClose}>
               Cancel
            </Button>
            {/* <Button disabled={loading} onClick={onConfirm}>
               Continue
            </Button> */}
         </div>
      </Modal>
   );
};
