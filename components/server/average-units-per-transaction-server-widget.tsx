import { getAverageUnitsPerTransaction } from '@/actions/get-transactions-metrics';
import { AverageUnitsPerTransactionWidget } from '../widgets/average-units-per-transaction-widget';

const AverageUnitsPerTransactionServerWidget = async ({
   storeId,
}: {
   storeId: number;
}) => {
   let averageUnitsPerTransaction;

   try {
      averageUnitsPerTransaction = await getAverageUnitsPerTransaction(storeId);
   } catch (error) {
      console.log(error);
   }
   return (
      <AverageUnitsPerTransactionWidget
         averageUnitsPerTransaction={averageUnitsPerTransaction}
      />
   );
};

export default AverageUnitsPerTransactionServerWidget;
