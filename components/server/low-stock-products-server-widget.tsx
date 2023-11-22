import { LowStockProductsWidget } from '../widgets/low-stock-products-widget';
import { getStore } from '@/lib/repositories/storesRepository';
import { getLowStockProducts } from '@/actions/get-products-metrics';

const LowStockProductsServerWidget = async ({
   storeId,
}: {
   storeId: number;
}) => {
   let lowStockProducts, low_stock_threshold;

   try {
      const store = await getStore(storeId);
      low_stock_threshold = (store?.settings as Record<string, any>)
         ?.low_stock_threshold;
      lowStockProducts = await getLowStockProducts(
         storeId,
         low_stock_threshold,
      );
   } catch (error) {
      console.log(error);
   }
   return (
      <LowStockProductsWidget
         lowStockProducts={lowStockProducts}
         lowStockThreshold={low_stock_threshold}
      />
   );
};

export default LowStockProductsServerWidget;
