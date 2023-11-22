import { SalesRevenueGraphWidget } from '../widgets/sales-revenue-widget';
import { getSalesRevenue } from '@/actions/get-sales-revenue';

const SalesRevenueGraphServerWidget = async ({
   storeId,
}: {
   storeId: number;
}) => {
   let graphData;

   try {
      graphData = await getSalesRevenue(storeId);
   } catch (error) {
      console.log(error);
   }
   return <SalesRevenueGraphWidget graphData={graphData} />;
};

export default SalesRevenueGraphServerWidget;
