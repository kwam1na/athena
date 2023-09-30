import { format } from 'date-fns';

import { CategoryColumn } from './components/columns';
import { CategoriesClient } from './components/client';
import { fetchCategories } from '@/lib/repositories/categoriesRepository';

const CategoriesPage = async ({ params }: { params: { storeId: string } }) => {
   const categories = await fetchCategories(params.storeId);
   const categoriesWithProductCount = categories.map((category) => {
      const productCount = category.products.reduce(
         (total, product) => total + (product.count || 0),
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
         <div className="flex-1 space-y-4 p-8 pt-6">
            <CategoriesClient data={formattedCategories} />
         </div>
      </div>
   );
};

export default CategoriesPage;
