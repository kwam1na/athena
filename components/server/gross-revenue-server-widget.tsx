import { getTotalGrossRevenue } from '@/actions/get-total-gross-revenue';
import { GrossRevenueWidget } from '../widgets/gross-revenue-widget';
import { getRevenueChange } from '@/actions/get-revenue-change';

const GrossRevenueServerWidget = async ({ storeId }: { storeId: number }) => {
   let grossRevenue, percentageChange;

   try {
      grossRevenue = await getTotalGrossRevenue(storeId);
      percentageChange = await getRevenueChange(storeId, 'gross');
   } catch (error) {
      console.log(error);
   }
   return (
      <GrossRevenueWidget
         grossRevenue={grossRevenue}
         percentageChange={percentageChange}
      />
   );
};

export default GrossRevenueServerWidget;
