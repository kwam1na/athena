import { format } from 'date-fns';
import { formatter } from '@/lib/utils';
import { ProductsClient } from './products/components/client';
import { ProductColumn } from './products/components/columns';
import { fetchProducts } from '@/lib/repositories/productsRepository';
import { getStore } from '@/lib/repositories/storesRepository';

const StorePage = async ({ params }: { params: { storeId: string } }) => {
   const products = await fetchProducts({ store_id: params.storeId });
   const store = await getStore(params.storeId);
   const fmt = formatter(store?.currency || 'usd');

   const formattedProducts: ProductColumn[] = products.map((item) => ({
      id: item.id,
      name: item.name,
      isFeatured: item.is_featured,
      isArchived: item.is_archived,
      price: fmt.format(item.price.toNumber()),
      costPerItem: fmt.format(item.cost_per_item.toNumber()),
      margin: (
         ((item.price.toNumber() - item.cost_per_item.toNumber()) /
            item.price.toNumber()) *
         100
      ).toFixed(2),
      category: item.category.name,
      subcategory: item.subcategory.name,
      sku: item.sku,
      size: item.size?.name || 'N/A',
      color: item.color?.value || 'N/A',
      count: item.count,
      createdAt: format(item.created_at, 'MMM d, yyyy'),
      updatedAt: format(item.updated_at, 'MMM d, yyyy'),
   }));

   return (
      <>
         <div className="flex-col">
            <div className="flex-1 space-y-4 p-8 pt-6">
               <ProductsClient data={formattedProducts} />
            </div>
         </div>
      </>
   );
};

export default StorePage;
