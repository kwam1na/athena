import { format } from 'date-fns';

import { SubcategoryColumn } from './components/columns';
import { SubcategoriesClient } from './components/client';
import { fetchSubcategories } from '@/lib/repositories/subcategoriesRepository';
import { fetchCategories } from '@/lib/repositories/categoriesRepository';
import { getStore } from '@/lib/repositories/storesRepository';

const SubcategoriesPage = async ({
   params,
}: {
   params: { storeId: string };
}) => {
   const subcategories = await fetchSubcategories(params.storeId);
   const categories = await fetchCategories(params.storeId);
   const store = await getStore(params.storeId);
   const storeName = store?.name || 'your store';

   const categoryOptions = categories.map((category) => ({
      label: category.name,
      value: category.name,
   }));

   const subcategoriesWithProductCount = subcategories.map((subcategory) => {
      const productCount = subcategory.products.reduce(
         (total, product) => total + (product.count || 0),
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
         category: item.category.name,
         productsCount: item.productCount,
         createdAt: format(item.created_at, 'MMM d, yyyy'),
         updatedAt: format(item.updated_at, 'MMM d, yyyy'),
      }));

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-4 p-8 pt-6">
            <SubcategoriesClient
               data={formattedSubcategories}
               categoryOptions={categoryOptions}
               storeName={storeName}
            />
         </div>
      </div>
   );
};

export default SubcategoriesPage;
