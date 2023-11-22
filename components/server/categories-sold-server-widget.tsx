import { getCategoryWiseMetrics } from '@/actions/get-transactions-metrics';
import { ProgressData, ProgressList } from '../ui/progress-list';
import { getTotalUnitsSoldForStore } from '@/actions/get-total-units';

const CategoriesSoldServerWidget = async ({ storeId }: { storeId: number }) => {
   let formattedCategoryMetrics: ProgressData[] = [];

   try {
      const categoriesMetrics = await getCategoryWiseMetrics(storeId);
      const totalUnitsSold = await getTotalUnitsSoldForStore(storeId);
      formattedCategoryMetrics = Object.keys(categoriesMetrics).map(
         (category) => {
            const percentage = (
               (categoriesMetrics[category].units_sold / totalUnitsSold) *
               100
            ).toFixed(2);
            return {
               title: category,
               percentage: parseFloat(percentage),
            };
         },
      );
   } catch (error) {
      console.log(error);
   }
   return formattedCategoryMetrics && formattedCategoryMetrics.length > 0 ? (
      <ProgressList
         data={formattedCategoryMetrics}
         header="Sales percentage by category"
      />
   ) : null;
};

export default CategoriesSoldServerWidget;
