import { format } from 'date-fns';

import { SubcategoryColumn } from './components/columns';
import { SubcategoriesClient } from './components/client';
import { fetchSubcategories } from '@/lib/repositories/subcategoriesRepository';
import { fetchCategories } from '@/lib/repositories/categoriesRepository';
import { getStore } from '@/lib/repositories/storesRepository';
import { EmptyState } from '@/components/states/empty/empty-state';
import { List, Package } from 'lucide-react';

const SubcategoriesPage = async ({
   params,
}: {
   params: { storeId: string; organizationId: string };
}) => {
   const storeId = parseInt(params.storeId);
   const subcategories = await fetchSubcategories(storeId, {
      products: true,
      category: true,
   });
   const categories = await fetchCategories(storeId);
   const store = await getStore(storeId);
   const storeName = store?.name || 'your store';

   const categoryOptions = categories.map((category) => ({
      label: category.name,
      value: category.name,
   }));

   const subcategoriesWithProductCount = subcategories.map((subcategory) => {
      // @ts-expect-error have to update the function signature
      const productCount = subcategory.products.reduce(
         // @ts-expect-error
         (total, product) => total + (product.inventory_count || 0),
         0,
      );
      return {
         ...subcategory,
         productCount,
      };
   });

   const formattedSubcategories: SubcategoryColumn[] =
      subcategoriesWithProductCount.map((item) => ({
         id: item.id,
         name: item.name,
         // @ts-expect-error have to update the function signature
         category: item.category.name,
         productsCount: item.productCount,
         createdAt: format(item.created_at, 'MMM d, yyyy'),
         updatedAt: format(item.updated_at, 'MMM d, yyyy'),
      }));

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-6">
            {formattedSubcategories.length > 0 && (
               <SubcategoriesClient
                  data={formattedSubcategories}
                  categoryOptions={categoryOptions}
                  storeName={storeName}
               />
            )}
            {formattedSubcategories.length == 0 && (
               <EmptyState
                  icon={
                     <List size={'112px'} color="#5C5C5C" strokeWidth={'1px'} />
                  }
                  action={{
                     ctaText: 'Add subcategory',
                     type: 'navigate',
                     params: {
                        url: `/organizations/${params.organizationId}/store/${params.storeId}/inventory/subcategories/new`,
                     },
                  }}
                  text="No subcategories added."
               />
            )}
         </div>
      </div>
   );
};

export default SubcategoriesPage;
