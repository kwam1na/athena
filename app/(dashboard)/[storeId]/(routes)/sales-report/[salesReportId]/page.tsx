import { keysToCamelCase } from '@/lib/utils';
import { SalesReportClient, Transaction } from '../components/client';
import { getTransaction } from '@/lib/repositories/transactionsRepository';

const SalesReportPage = async ({
   params,
}: {
   params: { storeId: string; salesReportId: string };
}) => {
   const transaction = await getTransaction(params.salesReportId);

   let fetchedTransaction: Transaction | undefined = undefined;

   if (transaction) {
      const items = transaction.transaction_items.map((item) =>
         keysToCamelCase(item),
      );
      fetchedTransaction = {
         id: transaction.id,
         transactionDate: new Date(transaction.transaction_date),
         reportTitle: transaction.transaction_report_title || 'N/A',
         transactionItems: items,
      };
   }

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-4 p-8 pt-6">
            <SalesReportClient fetchedTransaction={fetchedTransaction} />
         </div>
      </div>
   );
};

export default SalesReportPage;
