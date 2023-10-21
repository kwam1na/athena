'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

import { useToast } from '@/components/ui/use-toast';
import { apiUpdateProduct } from '@/lib/api/products';
import { ActionModal } from '@/components/modals/action-modal';
import { Input } from '@/components/ui/input';

interface ViewDataTableCellActionProps {
   data: any;
}

export const ViewDataTableCellAction: React.FC<
   ViewDataTableCellActionProps
> = ({ data }) => {
   const { toast } = useToast();
   const router = useRouter();
   const params = useParams();

   const [loading, setLoading] = useState(false);
   const [isEditInventoryCountModalOpen, setIsEditInventoryCountModalOpen] =
      useState(false);
   const [invalidUpdatedInventoryCount, setInvalidUpdatedInventoryCount] =
      useState(false);
   const [updatedInventoryCount, setUpdatedInventoryCount] = useState<
      number | undefined
   >(undefined);

   const { id, name, lowStockThreshold, setFormattedItems } = data;

   const onClose = () => {
      setIsEditInventoryCountModalOpen(false);
   };

   const updateInventoryCount = async () => {
      setLoading(true);
      try {
         await apiUpdateProduct(id, params.storeId, {
            inventory_count: updatedInventoryCount,
         });
         toast({
            title: `Inventory for ${name} updated successfully.`,
         });
         setFormattedItems((prev: any) => {
            return prev.filter((item: any) => item.id !== id);
         });
         setIsEditInventoryCountModalOpen(false);
         setUpdatedInventoryCount(undefined);
      } catch (error) {
         console.log('error:', error);
         toast({
            title: 'An error occured updating the inventory count of this product.',
         });
      } finally {
         setLoading(false);
      }
   };

   useEffect(() => {
      const isInvalid =
         updatedInventoryCount !== undefined &&
         (isNaN(updatedInventoryCount) ||
            updatedInventoryCount < lowStockThreshold);
      setInvalidUpdatedInventoryCount(isInvalid);
   }, [updatedInventoryCount]);

   useEffect(() => {
      setInvalidUpdatedInventoryCount(
         parseInt(data?.inventoryCount) < lowStockThreshold,
      );
   }, []);

   return (
      <>
         <ActionModal
            isOpen={isEditInventoryCountModalOpen}
            title="Update inventory count"
            description={`Update the inventory count for ${name}`}
            confirmText="Update"
            confirmButtonDisabled={invalidUpdatedInventoryCount}
            onConfirm={updateInventoryCount}
            loading={loading}
            onClose={onClose}
         >
            <div className="flex flex-col gap-4">
               <Input
                  type="number"
                  placeholder="Enter inventory count..."
                  onChange={(e) =>
                     setUpdatedInventoryCount(parseInt(e.target.value))
                  }
                  value={updatedInventoryCount}
                  defaultValue={data?.inventoryCount}
               />
               {invalidUpdatedInventoryCount && (
                  <span className="text-destructive text-xs ml-1">
                     {`Number must be greater than or equal to your store's low stock threshold of ${lowStockThreshold}`}
                  </span>
               )}
            </div>
         </ActionModal>
         <Button
            variant={'outline'}
            onClick={() => setIsEditInventoryCountModalOpen(true)}
         >
            Update
         </Button>
      </>
   );
};
