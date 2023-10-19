import { format } from 'date-fns';

import { ColorColumn } from './components/columns';
import { ColorClient } from './components/client';
import { fetchColors } from '@/lib/repositories/colorsRepository';
import { getStore } from '@/lib/repositories/storesRepository';
import { EmptyState } from '@/components/states/empty/empty-state';
import { CircleDashed, Package } from 'lucide-react';

const ColorsPage = async ({ params }: { params: { storeId: string } }) => {
   const colors = await fetchColors(params.storeId);

   const formattedColors: ColorColumn[] = colors.map((item) => ({
      id: item.id,
      name: item.name,
      value: item.value,
      createdAt: format(item.created_at, 'MMM d, yyyy'),
      updatedAt: format(item.updated_at, 'MMM d, yyyy'),
   }));

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-4 p-8 pt-6">
            {formattedColors.length > 0 && (
               <ColorClient data={formattedColors} />
            )}
            {formattedColors.length == 0 && (
               <EmptyState
                  icon={
                     <CircleDashed
                        size={'112px'}
                        color="#5C5C5C"
                        strokeWidth={'1px'}
                     />
                  }
                  action={{
                     ctaText: 'Add color',
                     type: 'navigate',
                     params: {
                        url: `/${params.storeId}/inventory/colors/new`,
                     },
                  }}
                  text="No colors added."
               />
            )}
         </div>
      </div>
   );
};

export default ColorsPage;
