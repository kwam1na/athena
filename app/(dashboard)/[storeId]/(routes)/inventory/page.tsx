import { format } from 'date-fns';
import { formatter } from '@/lib/utils';
import { ProductsClient } from './products/components/client';
import { ProductColumn } from './products/components/columns';
import { fetchProducts } from '@/lib/repositories/productsRepository';
import { getStore } from '@/lib/repositories/storesRepository';
import { fetchCategories } from '@/lib/repositories/categoriesRepository';
import { fetchSubcategories } from '@/lib/repositories/subcategoriesRepository';
import { EmptyState } from '@/components/states/empty/empty-state';
import { ShoppingBag } from 'lucide-react';

const StorePage = async ({ params }: { params: { storeId: string } }) => {
   const products = await fetchProducts({ store_id: params.storeId });
   const categories = await fetchCategories(params.storeId);
   const subcategories = await fetchSubcategories(params.storeId);

   const store = await getStore(params.storeId);
   const { low_stock_threshold } =
      (store?.settings as Record<string, any>) || {};
   const storeName = store?.name || 'your store';
   const fmt = formatter(store?.currency || 'usd');

   const categoryOptions = categories.map((category) => ({
      label: category.name,
      value: category.name,
   }));

   const subcategoryOptions = subcategories.map((subcategory) => ({
      label: subcategory.name,
      value: subcategory.name,
   }));

   const formattedProducts: ProductColumn[] = products.map((item) => ({
      id: item.id,
      name: item.name,
      isFeatured: item.is_featured,
      isArchived: item.is_archived,
      price: fmt.format(item.price),
      costPerItem: fmt.format(item.cost_per_item),
      margin: (((item.price - item.cost_per_item) / item.price) * 100).toFixed(
         2,
      ),
      category: item.category.name,
      subcategory: item.subcategory.name,
      sku: item.sku,
      size: item.size?.name || 'N/A',
      stockStatus:
         item.inventory_count === 0
            ? 'Out of stock'
            : item.inventory_count <= low_stock_threshold
            ? 'Low in stock'
            : 'In stock',
      color: item.color?.value || 'N/A',
      inventoryCount: item.inventory_count,
      createdAt: format(item.created_at, 'MMM d, yyyy'),
      updatedAt: format(item.updated_at, 'MMM d, yyyy'),
   }));

   return (
      <div className="flex-col">
         <div className="flex-1 p-4 pt-6">
            {formattedProducts.length > 0 && (
               <ProductsClient
                  storeName={storeName}
                  data={formattedProducts}
                  categoryOptions={categoryOptions}
                  subcategoryOptions={subcategoryOptions}
               />
            )}
            {formattedProducts.length == 0 && (
               <EmptyState
                  icon={
                     <ShoppingBag
                        size={'112px'}
                        color="#5C5C5C"
                        strokeWidth={'1px'}
                     />
                  }
                  action={{
                     type: 'navigate',
                     ctaText: 'Add product',
                     params: {
                        url: `/${params.storeId}/inventory/products/new`,
                     },
                  }}
                  text="No products added."
               />
            )}
         </div>
      </div>
   );
};

export default StorePage;
