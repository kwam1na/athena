import { SubategoryForm } from './components/subcategory-form';
import { getSubcategory } from '@/lib/repositories/subcategoriesRepository';
import { fetchCategories } from '@/lib/repositories/categoriesRepository';

const SubcategoryPage = async ({
   params,
}: {
   params: { subcategoryId: string; storeId: string };
}) => {
   const storeId = parseInt(params.storeId);
   const subcategory = await getSubcategory(params.subcategoryId);
   const categories = await fetchCategories(storeId);

   categories.unshift({
      id: 'add-new-category',
      name: 'Add new category',
      store_id: storeId,
      created_at: new Date(),
      updated_at: new Date(),
      subcategory: [],
      products: [],
      billboard_id: null,
   });

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-6">
            <SubategoryForm initialData={subcategory} categories={categories} />
         </div>
      </div>
   );
};

export default SubcategoryPage;
