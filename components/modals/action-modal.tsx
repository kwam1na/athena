'use client';

import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { LoadingButton } from '../ui/loading-button';
import { Skeleton } from '../ui/skeleton';

interface ActionModalProps {
   isOpen: boolean;
   title: string;
   description?: string;
   onClose: () => void;
   onConfirm?: () => void;
   confirmButtonDisabled?: boolean;
   confirmText?: string;
   shimmerButtons?: boolean;
   declineText?: string;
   loading?: boolean;
   children?: React.ReactNode;
   ctaButtonVariant?:
      | 'destructive'
      | 'outline'
      | 'secondary'
      | 'ghost'
      | 'link'
      | 'default';
}

export const ActionModal: React.FC<ActionModalProps> = ({
   isOpen,
   title,
   description,
   onClose,
   onConfirm,
   confirmText,
   confirmButtonDisabled,
   declineText,
   shimmerButtons,
   loading,
   children,
   ctaButtonVariant,
}) => {
   return (
      <Modal
         title={title}
         description={description}
         isOpen={isOpen}
         onClose={!loading ? onClose : () => {}}
      >
         <div>{children}</div>
         {!shimmerButtons && (
            <div className="pt-6 space-x-2 flex items-center justify-end w-full">
               <Button disabled={loading} variant="outline" onClick={onClose}>
                  {declineText || 'Cancel'}
               </Button>
               {onConfirm && (
                  <LoadingButton
                     isLoading={loading || false}
                     disabled={loading || confirmButtonDisabled}
                     onClick={onConfirm}
                     variant={ctaButtonVariant || 'default'}
                  >
                     {confirmText || 'Continue'}
                  </LoadingButton>
               )}
            </div>
         )}
         {shimmerButtons && (
            <div className="pt-6">
               <Skeleton className="w-[200px] h-[48px] ml-auto" />
            </div>
         )}
      </Modal>
   );
};
