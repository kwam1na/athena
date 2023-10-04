import { format } from 'date-fns';

import prismadb from '@/lib/prismadb';
import { formatter } from '@/lib/utils';

import { SalesReportsClient } from './components/sales-reports-client';
import { getStore } from '@/lib/repositories/storesRepository';

const SalesReportPage = async ({ params }: { params: { storeId: string } }) => {
   const store = await getStore(params.storeId);
   const fmt = formatter(store?.currency || 'usd');

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-4 p-8 pt-6">
            <SalesReportsClient data={[]} />
         </div>
      </div>
   );
};

export default SalesReportPage;
