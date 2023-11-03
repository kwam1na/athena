import { format } from 'date-fns';

import { formatter, keysToCamelCase, reflect } from '@/lib/utils';

import { TransactionsReportsClient } from './components/transactions-reports-client';
import { getStore } from '@/lib/repositories/storesRepository';
import { fetchTransactions } from '@/lib/repositories/transactionsRepository';
import { TransactionsReportColumn } from './components/transactions-reports-columns';
import { getTotalNetRevenue } from '@/actions/get-total-net-revenue';
import { getTotalUnitsSoldForStore } from '@/actions/get-total-units';
import { getTotalGrossRevenue } from '@/actions/get-total-gross-revenue';
import { getRevenueChange } from '@/actions/get-revenue-change';
import { getTotalUnitsSoldChange } from '@/actions/get-units-sold-change';
import {
   getAverageTransactionValue,
   getAverageUnitsPerTransaction,
   getCategoryWiseMetrics,
} from '@/actions/get-transactions-metrics';

const SalesReportPage = async ({ params }: { params: { storeId: string } }) => {
   const storeId = parseInt(params.storeId);
   const results = await Promise.all([
      reflect(getStore(storeId)),
      reflect(
         fetchTransactions({
            store_id: storeId,
            status: 'published',
         }),
      ),
      reflect(getTotalGrossRevenue(storeId)),
      reflect(getTotalNetRevenue(storeId)),
      reflect(getTotalUnitsSoldForStore(storeId)),
      reflect(getCategoryWiseMetrics(storeId)),
      reflect(getAverageUnitsPerTransaction(storeId)),
      reflect(getAverageTransactionValue(storeId)),
      reflect(getRevenueChange(storeId, 'gross')),
      reflect(getRevenueChange(storeId, 'net')),
      reflect(getTotalUnitsSoldChange(storeId)),
   ]);

   const store =
      results[0].status === 'fulfilled' ? results[0].value : undefined;
   const fmt = formatter(store?.currency || 'usd');

   const transactionReports =
      results[1].status === 'fulfilled' ? results[1].value : [];

   const grossRevenue =
      results[2].status === 'fulfilled' ? results[2].value : undefined;

   const netRevenue =
      results[3].status === 'fulfilled' ? results[3].value : undefined;
   const totalUnitsSold =
      results[4].status === 'fulfilled' ? results[4].value : undefined;
   const categoriesMetrics =
      results[5].status === 'fulfilled' ? results[5].value : {};

   const averageUnitsPerTransaction =
      results[6].status === 'fulfilled' ? results[6].value : undefined;
   const averageTransactionValue =
      results[7].status === 'fulfilled' ? results[7].value : undefined;

   const grossRevenuePercentageChange =
      results[8].status === 'fulfilled' ? results[8].value : 0;
   const netRevenuePercentageChange =
      results[9].status === 'fulfilled' ? results[9].value : 0;

   const totalUnitsSoldPercentageChange =
      results[10].status === 'fulfilled' ? results[10].value : 0;

   const sortedTransactionReports = [...transactionReports].sort(
      (a, b) =>
         new Date(b.transaction_date).getTime() -
         new Date(a.transaction_date).getTime(),
   );

   const formattedReports: TransactionsReportColumn[] =
      sortedTransactionReports.map((report) => ({
         id: report.id,
         title: report.transaction_report_title,
         transactionDate: format(report.transaction_date, 'MMM d, yyyy'),
         grossSales: fmt.format(report.gross_sales || 0),
         netRevenue: fmt.format(report.net_revenue || 0),
         unitsSold: report.units_sold || 0,
         createdAt: format(report.created_at, 'MMM d, yyyy'),
         updatedAt: format(report.updated_at, 'MMM d, yyyy'),
      }));

   const salesData = {
      grossRevenue,
      netRevenue,
      totalUnitsSold,
      grossRevenuePercentageChange,
      netRevenuePercentageChange,
      totalUnitsSoldPercentageChange,
      categoriesMetrics,
      averageTransactionValue,
      averageUnitsPerTransaction,
   };

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-6">
            <TransactionsReportsClient
               data={formattedReports}
               transactionReports={transactionReports}
               salesData={salesData}
               store={store?.name}
            />
         </div>
      </div>
   );
};

export default SalesReportPage;
