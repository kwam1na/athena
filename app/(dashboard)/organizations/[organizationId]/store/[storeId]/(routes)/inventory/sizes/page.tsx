import { format } from 'date-fns';

import { SizeColumn } from './components/columns';
import { SizesClient } from './components/client';
import { fetchSizes } from '@/lib/repositories/sizesRepository';
import { EmptyState } from '@/components/states/empty/empty-state';
import { Ruler } from 'lucide-react';

const SizesPage = async ({
   params,
}: {
   params: { storeId: string; organizationId: string };
}) => {
   const storeId = parseInt(params.storeId);
   const sizes = await fetchSizes(storeId);

   const formattedSizes: SizeColumn[] = sizes.map((item) => ({
      id: item.id,
      name: item.name,
      value: item.value,
      createdAt: format(item.created_at, 'MMM d, yyyy'),
      updatedAt: format(item.updated_at, 'MMM d, yyyy'),
   }));

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-6">
            {formattedSizes.length > 0 && <SizesClient data={formattedSizes} />}
            {formattedSizes.length == 0 && (
               <EmptyState
                  icon={
                     <Ruler
                        size={'112px'}
                        color="#5C5C5C"
                        strokeWidth={'1px'}
                     />
                  }
                  action={{
                     ctaText: 'Add size',
                     type: 'navigate',
                     params: {
                        url: `/organizations/${params.organizationId}/store/${params.storeId}/inventory/sizes/new`,
                     },
                  }}
                  text="No sizes added."
               />
            )}
         </div>
      </div>
   );
};

export default SizesPage;
