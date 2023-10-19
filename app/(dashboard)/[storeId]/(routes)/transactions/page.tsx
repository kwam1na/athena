import { format } from 'date-fns';

import { formatter, keysToCamelCase } from '@/lib/utils';

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
   const store = await getStore(params.storeId);
   const fmt = formatter(store?.currency || 'usd');

   const transactionReports = await fetchTransactions({
      store_id: params.storeId,
      status: 'published',
   });

   const formattedReports: TransactionsReportColumn[] = transactionReports.map(
      (report) => ({
         id: report.id,
         title: report.transaction_report_title,
         transactionDate: format(report.transaction_date, 'MMM d, yyyy'),
         grossSales: fmt.format(report.gross_sales || 0),
         netRevenue: fmt.format(report.net_revenue || 0),
         unitsSold: report.units_sold || 0,
         createdAt: format(report.created_at, 'MMM d, yyyy'),
         updatedAt: format(report.updated_at, 'MMM d, yyyy'),
      }),
   );

   const netRevenue = await getTotalNetRevenue(params.storeId);
   const totalUnitsSold = await getTotalUnitsSoldForStore(params.storeId);
   const grossRevenue = await getTotalGrossRevenue(params.storeId);
   const categoriesMetrics = await getCategoryWiseMetrics(params.storeId);
   const averageUnitsPerTransaction = await getAverageUnitsPerTransaction(
      params.storeId,
   );
   const averageTransactionValue = await getAverageTransactionValue(
      params.storeId,
   );

   const grossRevenuePercentageChange = await getRevenueChange(
      params.storeId,
      'gross',
   );
   const netRevenuePercentageChange = await getRevenueChange(
      params.storeId,
      'net',
   );

   const totalUnitsSoldPercentageChange = await getTotalUnitsSoldChange(
      params.storeId,
   );

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
         <div className="flex-1 space-y-4 p-8 pt-6">
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
