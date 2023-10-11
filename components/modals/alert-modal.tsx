'use client';

import { useEffect, useState } from 'react';

import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { LoadingButton } from '../ui/loading-button';

interface AlertModalProps {
   isOpen: boolean;
   title?: string;
   description?: string;
   ctaText?: string;
   onClose: () => void;
   onConfirm: () => void;
   loading: boolean;
}

export const AlertModal: React.FC<AlertModalProps> = ({
   ctaText,
   isOpen,
   title,
   description,
   onClose,
   onConfirm,
   loading,
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
         title={title || 'Are you sure?'}
         description={description || 'This action cannot be undone.'}
         isOpen={isOpen}
         onClose={onClose}
      >
         <div className="pt-6 space-x-2 flex items-center justify-end w-full">
            <Button disabled={loading} variant="outline" onClick={onClose}>
               Cancel
            </Button>
            <LoadingButton
               isLoading={loading}
               disabled={loading}
               variant="destructive"
               onClick={onConfirm}
            >
               {ctaText || 'Continue'}
            </LoadingButton>
         </div>
      </Modal>
   );
};
