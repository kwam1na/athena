import { format } from 'date-fns';

import { ColorColumn } from './components/columns';
import { ColorClient } from './components/client';
import { fetchColors } from '@/lib/repositories/colorsRepository';

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
            <ColorClient data={formattedColors} />
         </div>
      </div>
   );
};

export default ColorsPage;
