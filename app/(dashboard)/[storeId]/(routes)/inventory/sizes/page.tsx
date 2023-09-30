import { format } from 'date-fns';

import { SizeColumn } from './components/columns';
import { SizesClient } from './components/client';
import { fetchSizes } from '@/lib/repositories/sizesRepository';

const SizesPage = async ({ params }: { params: { storeId: string } }) => {
   const sizes = await fetchSizes(params.storeId);

   const formattedSizes: SizeColumn[] = sizes.map((item) => ({
      id: item.id,
      name: item.name,
      value: item.value,
      createdAt: format(item.created_at, 'MMM d, yyyy'),
      updatedAt: format(item.updated_at, 'MMM d, yyyy'),
   }));

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-4 p-8 pt-6">
            <SizesClient data={formattedSizes} />
         </div>
      </div>
   );
};

export default SizesPage;
