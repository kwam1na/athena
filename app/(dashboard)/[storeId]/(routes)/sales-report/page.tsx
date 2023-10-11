import { format } from 'date-fns';

import prismadb from '@/lib/prismadb';
import { formatter } from '@/lib/utils';

import { SalesReportsClient } from './components/sales-reports-client';
import { getStore } from '@/lib/repositories/storesRepository';
import { fetchTransactions } from '@/lib/repositories/transactionsRepository';
import { SalesReportColumn } from './components/sales-reports-columns';

const SalesReportPage = async ({ params }: { params: { storeId: string } }) => {
   const store = await getStore(params.storeId);
   const fmt = formatter(store?.currency || 'usd');

   const transactionReports = await fetchTransactions({
      store_id: params.storeId,
      status: 'published',
   });

   const formattedReports: SalesReportColumn[] = transactionReports.map(
      (report) => ({
         id: report.id,
         title: report.transaction_report_title,
         transactionDate: format(report.transaction_date, 'MMM d, yyyy'),
         grossSales: fmt.format(report.gross_sales || 0),
         netSales: fmt.format(report.net_sales || 0),
         unitsSold: report.units_sold || 0,
         createdAt: format(report.created_at, 'MMM d, yyyy'),
         updatedAt: format(report.updated_at, 'MMM d, yyyy'),
      }),
   );

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-4 p-8 pt-6">
            <SalesReportsClient data={formattedReports} />
         </div>
      </div>
   );
};

export default SalesReportPage;
