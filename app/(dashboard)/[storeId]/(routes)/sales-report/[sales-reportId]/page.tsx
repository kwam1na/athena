import prismadb from '@/lib/prismadb';

import { SalesReportClient } from '../components/client';

const SalesReportPage = async ({
   params,
}: {
   params: { categoryId: string; storeId: string };
}) => {
   // const category = await prismadb.category.findUnique({
   //    where: {
   //       id: params.categoryId,
   //    },
   // });

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-4 p-8 pt-6">
            <SalesReportClient data={[]} />
         </div>
      </div>
   );
};

export default SalesReportPage;
