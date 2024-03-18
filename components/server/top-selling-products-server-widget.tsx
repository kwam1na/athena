import { UnitsSoldColumn } from '@/[storeId]/(routes)/_components/view-data-table-columns';
import { getTopProductsForMonth } from '@/actions/get-transactions-metrics';
import { TopSellingProductsWidget } from '../widgets/top-selling-products-widget';

const TopSellingProductsServerWidget = async ({
   storeId,
}: {
   storeId: number;
}) => {
   let formattedProductMetrics: UnitsSoldColumn[] = [];

   try {
      const topProducts = await getTopProductsForMonth(
         storeId,
         new Date().getMonth() + 1,
         new Date().getFullYear(),
         5,
      );

      formattedProductMetrics =
         topProducts?.map((productMetric) => {
            const { units_sold, product_name } = productMetric[1];
            return {
               name: product_name,
               unitsSold: `${units_sold} units`,
            };
         }) || [];
   } catch (error) {
      console.log(error);
   }

   return (
      <TopSellingProductsWidget topSellingProducts={formattedProductMetrics} />
   );
};

export default TopSellingProductsServerWidget;
