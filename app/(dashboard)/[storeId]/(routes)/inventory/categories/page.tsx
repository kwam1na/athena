import { format } from 'date-fns';

import { CategoryColumn } from './components/columns';
import { CategoriesClient } from './components/client';
import { fetchCategories } from '@/lib/repositories/categoriesRepository';
import { getStore } from '@/lib/repositories/storesRepository';
import { EmptyState } from '@/components/states/empty/empty-state';
import { List } from 'lucide-react';

const CategoriesPage = async ({ params }: { params: { storeId: string } }) => {
   const store = await getStore(params.storeId);
   const storeName = store?.name || 'your store';
   const categories = await fetchCategories(params.storeId);
   const categoriesWithProductCount = categories.map((category) => {
      const productCount = category.products.reduce(
         (total, product) => total + (product.inventory_count || 0),
         0,
      );
      return {
         ...category,
         productCount,
      };
   });

   const formattedCategories: CategoryColumn[] = categoriesWithProductCount.map(
      (item) => ({
         id: item.id,
         name: item.name,
         productsCount: item.productCount,
         createdAt: format(item.created_at, 'MMM d, yyyy'),
         updatedAt: format(item.updated_at, 'MMM d, yyyy'),
      }),
   );

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-4 p-4 pt-6">
            {formattedCategories.length > 0 && (
               <CategoriesClient
                  data={formattedCategories}
                  storeName={storeName}
               />
            )}
            {formattedCategories.length == 0 && (
               <EmptyState
                  icon={
                     <List size={'112px'} color="#5C5C5C" strokeWidth={'1px'} />
                  }
                  action={{
                     ctaText: 'Add category',
                     type: 'navigate',
                     params: {
                        url: `/${params.storeId}/inventory/categories/new`,
                     },
                  }}
                  text="No categories added."
               />
            )}
         </div>
      </div>
   );
};

export default CategoriesPage;
