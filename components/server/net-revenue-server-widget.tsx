import { getRevenueChange } from '@/actions/get-revenue-change';
import { NetRevenueWidget } from '../widgets/net-revenue-widget';
import { getTotalNetRevenue } from '@/actions/get-total-net-revenue';

const NetRevenueServerWidget = async ({ storeId }: { storeId: number }) => {
   let netRevenue, percentageChange;

   try {
      netRevenue = await getTotalNetRevenue(storeId);
      percentageChange = await getRevenueChange(storeId, 'net');
   } catch (error) {
      console.log(error);
   }
   return (
      <NetRevenueWidget
         netRevenue={netRevenue}
         percentageChange={percentageChange}
      />
   );
};

export default NetRevenueServerWidget;
