import { TotalStockWidget } from '../widgets/total-units-in-stock-widget';
import { getTotalUnitsSoldForStore } from '@/actions/get-total-units';

const TotalStockServerWidget = async ({ storeId }: { storeId: number }) => {
   let stockCount;

   try {
      stockCount = await getTotalUnitsSoldForStore(storeId);
   } catch (error) {
      console.log(error);
   }
   return <TotalStockWidget stockCount={stockCount} />;
};

export default TotalStockServerWidget;
