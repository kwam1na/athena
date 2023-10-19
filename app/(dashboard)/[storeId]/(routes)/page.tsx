import { CreditCard, DollarSign, File, Package } from 'lucide-react';

import { Separator } from '@/components/ui/separator';
import { Overview } from '@/components/overview';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Heading } from '@/components/ui/heading';
import { getTotalGrossRevenue } from '@/actions/get-total-gross-revenue';
import { getSalesCount } from '@/actions/get-sales-count';
import { getGraphRevenue } from '@/actions/get-graph-revenue';
import { getStockCount } from '@/actions/get-stock-count';
import { formatter, reflect } from '@/lib/utils';
import { getStore } from '@/lib/repositories/storesRepository';
import Link from 'next/link';
import { getTotalUnitsSoldForStore } from '@/actions/get-total-units';
import { getRevenueChange } from '@/actions/get-revenue-change';
import { getTotalUnitsSoldChange } from '@/actions/get-units-sold-change';
import { getTotalNetRevenue } from '@/actions/get-total-net-revenue';
import { MetricCard } from '@/components/ui/metric-card';
import { getSession } from '@auth0/nextjs-auth0';
import { getUser } from '@/lib/repositories/userRepository';
import {
   getAverageTransactionValue,
   getAverageUnitsPerTransaction,
   getCategoryWiseMetrics,
   getTopProductsForMonth,
   getTotalTransactionReports,
} from '@/actions/get-transactions-metrics';
import { ProgressList } from '@/components/ui/progress-list';
import {
   UnitsSoldColumn,
   lowStockProductsColumns,
   unitsSoldColumns,
} from './components/view-data-table-columns';
import { ViewDataTableClient } from './components/view-data-table-client';
import { getLowStockProducts } from '@/actions/get-products-metrics';

interface DashboardPageProps {
   params: {
      storeId: string;
   };
}

const DashboardPage: React.FC<DashboardPageProps> = async ({ params }) => {
   const results = await Promise.all([
      reflect(getTotalGrossRevenue(params.storeId)),
      reflect(getTotalNetRevenue(params.storeId)),
      reflect(getGraphRevenue(params.storeId)),
      reflect(getTotalUnitsSoldForStore(params.storeId)),
      reflect(getStockCount(params.storeId)),
      reflect(getCategoryWiseMetrics(params.storeId)),
      reflect(
         getTopProductsForMonth(
            params.storeId,
            new Date().getMonth() + 1,
            new Date().getFullYear(),
            5,
         ),
      ),
      reflect(getRevenueChange(params.storeId, 'gross')),
      reflect(getRevenueChange(params.storeId, 'net')),
      reflect(getTotalUnitsSoldChange(params.storeId)),
      reflect(getAverageUnitsPerTransaction(params.storeId)),
      reflect(getAverageTransactionValue(params.storeId)),
   ]);

   const totalRevenue =
      results[0].status === 'fulfilled' ? results[0].value : 0;
   const netRevenue = results[1].status === 'fulfilled' ? results[1].value : 0;
   const graphRevenue =
      results[2].status === 'fulfilled' ? results[2].value : undefined;
   const totalUnitsSold =
      results[3].status === 'fulfilled' ? results[3].value : 1;
   const stockCount = results[4].status === 'fulfilled' ? results[4].value : 0;
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
      results[10].status === 'fulfilled' ? results[10].value : 0;
   const averageTransactionValue =
      results[11].status === 'fulfilled' ? results[11].value : 0;

   const session = await getSession();
   const u = session?.user;

   const user = await getUser(u?.sub || '');

   const store = await getStore(params.storeId);
   const { settings } = store || {};
   const { low_stock_threshold } = (settings as Record<string, any>) || {};
   const storeName = store?.name || 'your store';
   const fmt = formatter(store?.currency || 'usd');

   let lowStockProducts;
   if (low_stock_threshold) {
      lowStockProducts = await getLowStockProducts(
         params.storeId,
         low_stock_threshold,
      );
   }

   const formattedCategoryMetrics = Object.keys(categoriesMetrics).map(
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
   );

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
         <div className="flex-1 space-y-4 p-8 pt-6">
            <Heading
               title={user ? `Hi, ${user.name}` : 'Dashboard'}
               description={`Here's how ${storeName} is doing`}
            />
            {/* <Separator /> */}
            <div className="grid gap-4 grid-cols-3 pt-4">
               {
                  <Link href={`/${params.storeId}/transactions`}>
                     <MetricCard
                        title={'Gross revenue'}
                        value={fmt.format(totalRevenue)}
                        icon={
                           <DollarSign className="h-4 w-4 text-muted-foreground" />
                        }
                        percentageChange={grossRevenuePercentageChange}
                     />
                  </Link>
               }

               {
                  <Link href={`/${params.storeId}/transactions`}>
                     <MetricCard
                        title={'Net revenue'}
                        value={fmt.format(netRevenue)}
                        icon={
                           <DollarSign className="h-4 w-4 text-muted-foreground" />
                        }
                        percentageChange={netRevenuePercentageChange}
                     />
                  </Link>
               }

               <Link href={`/${params.storeId}/transactions`}>
                  <MetricCard
                     title={'Total units sold'}
                     value={totalUnitsSold.toString()}
                     icon={
                        <CreditCard className="h-4 w-4 text-muted-foreground" />
                     }
                     percentageChange={totalUnitsSoldPercentageChange}
                  />
               </Link>
            </div>

            <div>
               {graphRevenue && graphRevenue.length > 1 && (
                  <Card className="col-span-4 bg-background w-full">
                     <CardHeader>
                        <CardTitle>Sales revenue</CardTitle>
                     </CardHeader>
                     <CardContent className="pl-2 h-full p-8">
                        <Overview data={graphRevenue} />
                     </CardContent>
                  </Card>
               )}
            </div>

            <div className="flex gap-8">
               <div className="flex flex-col gap-4 w-[50%]">
                  <div className="flex gap-4 w-full justify-between">
                     <div className="w-[50%]">
                        <MetricCard
                           title={'Avg transaction value (gross)'}
                           value={fmt.format(
                              isNaN(averageTransactionValue)
                                 ? 0
                                 : averageTransactionValue,
                           )}
                           icon={
                              <DollarSign className="h-4 w-4 text-muted-foreground" />
                           }
                        />
                     </div>
                     <div className="w-[50%]">
                        <MetricCard
                           title={'Avg units per transaction'}
                           value={
                              isNaN(averageUnitsPerTransaction)
                                 ? '0'
                                 : averageUnitsPerTransaction.toString()
                           }
                           icon={
                              <Package className="h-4 w-4 text-muted-foreground" />
                           }
                        />
                     </div>
                  </div>
                  {
                     <Link href={`/${params.storeId}/inventory/products`}>
                        <MetricCard
                           title={'Products in stock'}
                           value={stockCount.toString()}
                           icon={
                              <Package className="h-4 w-4 text-muted-foreground" />
                           }
                        />
                     </Link>
                  }

                  {lowStockProducts && lowStockProducts.length > 1 && (
                     <div className="border rounded-lg p-8 space-y-8">
                        <p className="text-md">Stock alerts</p>
                        {lowStockProducts && lowStockProducts.length > 1 && (
                           <ViewDataTableClient
                              data={lowStockProducts || []}
                              columns={lowStockProductsColumns}
                              additionalData={{ low_stock_threshold }}
                              type="low-stock-products"
                           />
                        )}
                        {!lowStockProducts && (
                           <p className="border rounded-lg text-sm text-muted-foreground text-center p-4">
                              No stock alerts
                           </p>
                        )}
                     </div>
                  )}
               </div>

               {
                  <div className="w-[50%] flex space-y-4 border rounded-lg gap-8">
                     <div className="w-[50%] p-8 space-y-8">
                        <p className="text-md">
                           Top selling products this month
                        </p>
                        {formattedProductMetrics.length > 1 && (
                           <ViewDataTableClient
                              data={formattedProductMetrics}
                              columns={unitsSoldColumns}
                              type={'top-selling-products'}
                           />
                        )}
                        {formattedProductMetrics.length == 0 && (
                           <p className="border rounded-lg text-sm text-muted-foreground text-center p-4">
                              No data
                           </p>
                        )}
                     </div>

                     {formattedCategoryMetrics.length > 0 && (
                        <div className="w-[50%] pb-8 pr-8">
                           <ProgressList
                              data={formattedCategoryMetrics}
                              header="Sales percentage by category"
                           />
                        </div>
                     )}
                  </div>
               }
            </div>
         </div>
      </div>
   );
};

export default DashboardPage;
