import { format } from 'date-fns';
import { formatter } from '@/lib/utils';

import { ProductsClient } from './components/client';
import { ProductColumn } from './components/columns';
import { fetchProducts } from '@/lib/repositories/productsRepository';
import { fetchCategories } from '@/lib/repositories/categoriesRepository';
import { fetchSubcategories } from '@/lib/repositories/subcategoriesRepository';
import { getStore } from '@/lib/repositories/storesRepository';

const ProductsPage = async ({ params }: { params: { storeId: string } }) => {
   const products = await fetchProducts({ store_id: params.storeId });
   const categories = await fetchCategories(params.storeId);
   const subcategories = await fetchSubcategories(params.storeId);

   const store = await getStore(params.storeId);
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
      size: item.size?.value || 'N/A',
      color: item.color?.value || 'N/A',
      inventoryCount: item.inventory_count,
      createdAt: format(item.created_at, 'MMM d, yyyy'),
      updatedAt: format(item.updated_at, 'MMM d, yyyy'),
   }));

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-4 p-8 pt-6">
            <ProductsClient
               storeName={storeName}
               data={formattedProducts}
               categoryOptions={categoryOptions}
               subcategoryOptions={subcategoryOptions}
            />
         </div>
      </div>
   );
};

export default ProductsPage;
