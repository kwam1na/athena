'use client';

import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { LoadingButton } from '../ui/loading-button';

interface ActionModalProps {
   isOpen: boolean;
   title: string;
   description: string;
   onClose: () => void;
   onConfirm?: () => void;
   confirmButtonDisabled?: boolean;
   loading?: boolean;
   children?: React.ReactNode;
}

export const ActionModal: React.FC<ActionModalProps> = ({
   isOpen,
   title,
   description,
   onClose,
   onConfirm,
   confirmButtonDisabled,
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
            {onConfirm && (
               <LoadingButton
                  isLoading={loading || false}
                  disabled={loading || confirmButtonDisabled}
                  onClick={onConfirm}
               >
                  Continue
               </LoadingButton>
            )}
         </div>
      </Modal>
   );
};
