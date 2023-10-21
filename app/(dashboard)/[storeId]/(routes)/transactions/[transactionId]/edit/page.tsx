import { keysToCamelCase } from '@/lib/utils';
import { Transaction } from '@/types/transactions';
import { getTransaction } from '@/lib/repositories/transactionsRepository';
import { TransactionsReportClient } from '../../components/client';

const SalesReportPage = async ({
   params,
}: {
   params: { storeId: string; transactionId: string };
}) => {
   const transaction = await getTransaction(params.transactionId);

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
            <TransactionsReportClient fetchedTransaction={fetchedTransaction} />
         </div>
      </div>
   );
};

export default SalesReportPage;
