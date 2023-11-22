import { getAverageTransactionValue } from '@/actions/get-transactions-metrics';
import { AverageTransactionValueWidget } from '../widgets/average-transactions-value-widget';

const AverageTransactionValueServerWidget = async ({
   storeId,
}: {
   storeId: number;
}) => {
   let averageTransactionValue;

   try {
      averageTransactionValue = await getAverageTransactionValue(storeId);
   } catch (error) {
      console.log(error);
   }
   return (
      <AverageTransactionValueWidget
         averageTransactionValue={averageTransactionValue}
      />
   );
};

export default AverageTransactionValueServerWidget;
