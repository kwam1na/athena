import { Separator } from '@/components/ui/separator';
import { Heading } from '@/components/ui/heading';
import { getTotalGrossRevenue } from '@/actions/get-total-gross-revenue';
import { getSalesCount } from '@/actions/get-sales-count';
import { getSalesRevenue } from '@/actions/get-sales-revenue';
import { getStockCount } from '@/actions/get-stock-count';
import { reflect } from '@/lib/utils';
import { getStore } from '@/lib/repositories/storesRepository';
import { getTotalUnitsSoldForStore } from '@/actions/get-total-units';
import { getRevenueChange } from '@/actions/get-revenue-change';
import { getTotalUnitsSoldChange } from '@/actions/get-units-sold-change';
import { getTotalNetRevenue } from '@/actions/get-total-net-revenue';
import { getUser } from '@/lib/repositories/userRepository';
import {
   getAverageTransactionValue,
   getAverageUnitsPerTransaction,
   getCategoryWiseMetrics,
   getTopProductsForMonth,
   getTotalTransactionReports,
} from '@/actions/get-transactions-metrics';
import { ProgressList } from '@/components/ui/progress-list';
import { UnitsSoldColumn } from './_components/view-data-table-columns';
import { getLowStockProducts } from '@/actions/get-products-metrics';
import { GrossRevenueWidget } from '@/components/widgets/gross-revenue-widget';
import { NetRevenueWidget } from '@/components/widgets/net-revenue-widget';
import { TotalUnitsSoldWidget } from '@/components/widgets/total-units-sold-widget';
import { AverageTransactionValueWidget } from '@/components/widgets/average-transactions-value-widget';
import { AverageUnitsPerTransactionWidget } from '@/components/widgets/average-units-per-transaction-widget';
import { TotalStockWidget } from '@/components/widgets/total-units-in-stock-widget';
import { LowStockProductsWidget } from '@/components/widgets/low-stock-products-widget';
import { TopSellingProductssWidget } from '@/components/widgets/top-selling-products-widget';
import { SalesRevenueGraphWidget } from '@/components/widgets/sales-revenue-widget';
import { captureException } from '@sentry/nextjs';
import { TaskAlert } from '@/components/ui/task-alert';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import logger from '@/lib/logger/console-logger';
interface DashboardPageProps {
   params: {
      storeId: string;
      organizationId: string;
   };
}

const DashboardPage: React.FC<DashboardPageProps> = async ({ params }) => {
   const cookieData = (name: string) => cookies().get(name)?.value;
   const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
         cookies: {
            get(name: string) {
               return cookieData(name);
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

   const results = await Promise.all([
      reflect(getTotalGrossRevenue(storeId)),
      reflect(getTotalNetRevenue(storeId)),
      reflect(getSalesRevenue(storeId)),
      reflect(getTotalUnitsSoldForStore(storeId)),
      reflect(getStockCount(storeId)),
      reflect(getCategoryWiseMetrics(storeId)),
      reflect(
         getTopProductsForMonth(
            storeId,
            new Date().getMonth() + 1,
            new Date().getFullYear(),
            5,
         ),
      ),
      reflect(getRevenueChange(storeId, 'gross')),
      reflect(getRevenueChange(storeId, 'net')),
      reflect(getTotalUnitsSoldChange(storeId)),
      reflect(getAverageUnitsPerTransaction(storeId)),
      reflect(getAverageTransactionValue(storeId)),
   ]);

   const totalRevenue =
      results[0].status === 'fulfilled' ? results[0].value : undefined;
   const netRevenue =
      results[1].status === 'fulfilled' ? results[1].value : undefined;
   const graphRevenue =
      results[2].status === 'fulfilled' ? results[2].value : undefined;
   const totalUnitsSold =
      results[3].status === 'fulfilled' ? results[3].value : undefined;
   const stockCount =
      results[4].status === 'fulfilled' ? results[4].value : undefined;
   const categoriesMetrics =
      results[5].status === 'fulfilled' ? results[5].value : {};
   const productsMetrics =
      results[6].status === 'fulfilled' ? results[6].value : undefined;
   const grossRevenuePercentageChange =
      results[7].status === 'fulfilled' ? results[7].value : 0;
   const netRevenuePercentageChange =
      results[8].status === 'fulfilled' ? results[8].value : 0;

   const totalUnitsSoldPercentageChange =
      results[9].status === 'fulfilled' ? results[9].value : 0;

   const averageUnitsPerTransaction =
      results[10].status === 'fulfilled' ? results[10].value : undefined;
   const averageTransactionValue =
      results[11].status === 'fulfilled' ? results[11].value : undefined;

   results.forEach((result, idx) => {
      if (result.status === 'rejected') {
         logger.error(`Promise ${idx} failed with reason: ${result.reason}`);
         captureException(
            `Promise ${idx} failed with reason: ${
               (result.reason as Error).message
            }`,
         );
      }
   });

   const store = await getStore(storeId);
   const { settings } = store || {};
   const { low_stock_threshold } = (settings as Record<string, any>) || {};
   const storeName = store?.name || 'your store';

   let lowStockProducts;
   if (low_stock_threshold) {
      const lowStockProductsResult = await reflect(
         getLowStockProducts(storeId, low_stock_threshold),
      );
      lowStockProducts =
         lowStockProductsResult.status === 'fulfilled'
            ? lowStockProductsResult.value
            : undefined;
   }

   let formattedCategoryMetrics;
   if (totalUnitsSold) {
      formattedCategoryMetrics = Object.keys(categoriesMetrics).map(
         (category) => {
            const percentage = (
               (categoriesMetrics[category].units_sold / totalUnitsSold) *
               100
            ).toFixed(2);
            return {
               title: category,
               percentage: parseFloat(percentage),
            };
         },
         1,
      );
   }

   const formattedProductMetrics: UnitsSoldColumn[] =
      productsMetrics?.map((productMetric) => {
         const { units_sold, product_name } = productMetric[1];
         return {
            name: product_name,
            unitsSold: `${units_sold} units`,
         };
      }) || [];

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
               <div className="grid gap-4 grid-cols-3 pt-4">
                  <GrossRevenueWidget
                     grossRevenue={totalRevenue}
                     percentageChange={grossRevenuePercentageChange}
                  />

                  <NetRevenueWidget
                     netRevenue={netRevenue}
                     percentageChange={netRevenuePercentageChange}
                  />

                  <TotalUnitsSoldWidget
                     totalUnitsSold={totalUnitsSold}
                     percentageChange={totalUnitsSoldPercentageChange}
                  />
               </div>

               <SalesRevenueGraphWidget graphData={graphRevenue} />

               <div className="flex flex-col lg:flex-row gap-8 w-full">
                  <div className="flex flex-col gap-4 w-full lg:w-[50%]">
                     <TotalStockWidget stockCount={stockCount} />
                     <div className="flex flex-col gap-4 w-full justify-between lg:flex-row">
                        <div className="w-full lg:w-[50%]">
                           <AverageTransactionValueWidget
                              averageTransactionValue={averageTransactionValue}
                           />
                        </div>
                        <div className="w-full lg:w-[50%]">
                           <AverageUnitsPerTransactionWidget
                              averageUnitsPerTransaction={
                                 averageUnitsPerTransaction
                              }
                           />
                        </div>
                     </div>

                     <LowStockProductsWidget
                        lowStockProducts={lowStockProducts}
                        lowStockThreshold={low_stock_threshold}
                     />
                  </div>

                  <div className="w-full lg:w-[50%] flex flex-col gap-4 p-4 border rounded-lg">
                     <div className="w-full p-4 space-y-8">
                        <TopSellingProductssWidget
                           topSellingProducts={formattedProductMetrics}
                        />
                     </div>
                     {formattedCategoryMetrics &&
                        formattedCategoryMetrics.length > 0 && (
                           <div className="w-full p-4">
                              <ProgressList
                                 data={formattedCategoryMetrics}
                                 header="Sales percentage by category"
                              />
                           </div>
                        )}
                  </div>
               </div>
            </div>
         </div>
      </div>
   );
};

export default DashboardPage;
