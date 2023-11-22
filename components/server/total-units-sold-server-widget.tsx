import { TotalUnitsSoldWidget } from '../widgets/total-units-sold-widget';
import { getTotalUnitsSoldForStore } from '@/actions/get-total-units';
import { getTotalUnitsSoldChange } from '@/actions/get-units-sold-change';

const TotalUnitsSoldServerWidget = async ({ storeId }: { storeId: number }) => {
   let totalUnitsSold, percentageChange;

   try {
      totalUnitsSold = await getTotalUnitsSoldForStore(storeId);
      percentageChange = await getTotalUnitsSoldChange(storeId);
   } catch (error) {
      console.log(error);
   }
   return (
      <TotalUnitsSoldWidget
         totalUnitsSold={totalUnitsSold}
         percentageChange={percentageChange}
      />
   );
};

export default TotalUnitsSoldServerWidget;
