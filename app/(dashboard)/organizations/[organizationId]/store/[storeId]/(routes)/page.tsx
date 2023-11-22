import { Separator } from '@/components/ui/separator';
import { Heading } from '@/components/ui/heading';
import { getStockCount } from '@/actions/get-stock-count';
import { getStore } from '@/lib/repositories/storesRepository';
import { getUser } from '@/lib/repositories/userRepository';
import { TaskAlert } from '@/components/ui/task-alert';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import logger from '@/lib/logger/console-logger';
import AverageTransactionValueServerWidget from '@/components/server/average-transaction-value-server-widget';
import AverageUnitsPerTransactionServerWidget from '@/components/server/average-units-per-transaction-server-widget';
import LowStockProductsServerWidget from '@/components/server/low-stock-products-server-widget';
import TopSellingProductsServerWidget from '@/components/server/top-selling-products-server-widget';
import SalesRevenueGraphServerWidget from '@/components/server/sales-revenue-server-widget';
import GrossRevenueServerWidget from '@/components/server/gross-revenue-server-widget';
import NetRevenueServerWidget from '@/components/server/net-revenue-server-widget';
import TotalUnitsSoldServerWidget from '@/components/server/total-units-sold-server-widget';
import TotalStockServerWidget from '@/components/server/total-stock-server-widget';
import CategoriesSoldServerWidget from '@/components/server/categories-sold-server-widget';
interface DashboardPageProps {
   params: {
      storeId: string;
      organizationId: string;
   };
}

async function getCookieData(name: string) {
   return cookies().get(name)?.value;
}

export const dynamic = 'force-dynamic';

const DashboardPage: React.FC<DashboardPageProps> = async ({ params }) => {
   const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
         cookies: {
            get(name: string) {
               return getCookieData(name);
            },
         },
      },
   );

   const {
      data: { session },
   } = await supabase.auth.getSession();
   const u = session?.user;
   const user = await getUser(u?.id || '');

   const storeId = parseInt(params.storeId);
   const stockCount = await getStockCount(storeId);

   const store = await getStore(storeId);
   const storeName = store?.name || 'your store';

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-16">
            <div className="space-y-4">
               <Heading
                  title={user ? `Hi, ${user.name}` : 'Dashboard'}
                  description={`Here's how ${storeName} is doing`}
               />
               {/* <Separator /> */}
               {typeof stockCount === 'number' && stockCount === 0 && (
                  <TaskAlert
                     title="Empty shelves!"
                     description="Looks like there are no products in your inventory. Add a product to get started."
                     action={{
                        type: 'navigate',
                        ctaText: 'Add product',
                        route: `/organizations/${params.organizationId}/store/${params.storeId}/inventory/products/new`,
                     }}
                  />
               )}
            </div>
            <div className="space-y-4">
               <div className="grid gap-4 lg:grid-cols-3 grid-cols-1 pt-4">
                  <GrossRevenueServerWidget storeId={storeId} />
                  <NetRevenueServerWidget storeId={storeId} />
                  <TotalUnitsSoldServerWidget storeId={storeId} />
               </div>

               <SalesRevenueGraphServerWidget storeId={storeId} />

               <div className="flex flex-col lg:flex-row gap-8 w-full">
                  <div className="flex flex-col gap-4 w-full lg:w-[50%]">
                     <TotalStockServerWidget storeId={storeId} />
                     <div className="flex flex-col gap-4 w-full justify-between lg:flex-row">
                        <div className="w-full lg:w-[50%]">
                           <AverageTransactionValueServerWidget
                              storeId={storeId}
                           />
                        </div>
                        <div className="w-full lg:w-[50%]">
                           <AverageUnitsPerTransactionServerWidget
                              storeId={storeId}
                           />
                        </div>
                     </div>

                     <LowStockProductsServerWidget storeId={storeId} />
                  </div>

                  <div className="w-full lg:w-[50%] flex flex-col gap-4 p-4 border rounded-lg">
                     <div className="w-full p-4 space-y-8">
                        <TopSellingProductsServerWidget storeId={storeId} />
                     </div>
                     <CategoriesSoldServerWidget storeId={storeId} />
                  </div>
               </div>
            </div>
         </div>
      </div>
   );
};

export default DashboardPage;
