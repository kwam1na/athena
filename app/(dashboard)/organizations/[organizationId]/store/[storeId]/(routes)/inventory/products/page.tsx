import { format } from 'date-fns';
import { formatter } from '@/lib/utils';

import { ProductsClient } from './components/client';
import { ProductColumn } from './components/columns';
import { fetchProducts } from '@/lib/repositories/productsRepository';
import { fetchCategories } from '@/lib/repositories/categoriesRepository';
import { fetchSubcategories } from '@/lib/repositories/subcategoriesRepository';
import { getStore } from '@/lib/repositories/storesRepository';
import { EmptyState } from '@/components/states/empty/empty-state';
import { Package, ShoppingBag } from 'lucide-react';
import TableSkeleton from '@/components/states/loading/table-skeleton';

const ProductsPage = async ({
   params,
}: {
   params: { storeId: string; organizationId: string };
}) => {
   const storeId = parseInt(params.storeId);
   const products = await fetchProducts({ store_id: storeId });
   const categories = await fetchCategories(storeId);
   const subcategories = await fetchSubcategories(storeId);

   const store = await getStore(storeId);
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
      category: item.category?.name || 'N/A',
      subcategory: item.subcategory?.name || 'N/A',
      sku: item.sku || 'No SKU',
      stockStatus:
         item.inventory_count === 0
            ? 'Out of stock'
            : item.inventory_count <= low_stock_threshold
            ? 'Low in stock'
            : 'In stock',
      size: item.size?.value || 'N/A',
      color: item.color?.value || 'N/A',
      inventoryCount: item.inventory_count,
      createdAt: format(item.created_at, 'MMM d, yyyy'),
      updatedAt: format(item.updated_at, 'MMM d, yyyy'),
   }));

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-6">
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
                        url: `/organizations/${params.organizationId}/store/${params.storeId}/inventory/products/new`,
                     },
                  }}
                  text="No products added."
               />
            )}
         </div>
      </div>
   );
};

export default ProductsPage;
