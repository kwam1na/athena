import { SubategoryForm } from './components/subcategory-form';
import { getSubcategory } from '@/lib/repositories/subcategoriesRepository';
import { fetchCategories } from '@/lib/repositories/categoriesRepository';

const SubcategoryPage = async ({
   params,
}: {
   params: { subcategoryId: string; storeId: string };
}) => {
   const subcategory = await getSubcategory(params.subcategoryId);

   const categories = await fetchCategories(params.storeId);

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-4 p-4 pt-6">
            <SubategoryForm initialData={subcategory} categories={categories} />
         </div>
      </div>
   );
};

export default SubcategoryPage;
