import prismadb from '@/lib/prismadb';
import { ProductForm } from './components/product-form';
import { getProduct } from '@/lib/repositories/productsRepository';
import { fetchCategories } from '@/lib/repositories/categoriesRepository';
import { fetchSubcategories } from '@/lib/repositories/subcategoriesRepository';
import { fetchSizes } from '@/lib/repositories/sizesRepository';

const ProductPage = async ({
   params,
}: {
   params: { productId: string; storeId: string };
}) => {
   const storeId = parseInt(params.storeId);
   const product = await getProduct(params.productId);
   const categories = await fetchCategories(storeId);
   const subcategories = await fetchSubcategories(storeId);
   const sizes = await fetchSizes(storeId);

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

   subcategories.unshift({
      id: 'add-new-subcategory',
      name: 'Add new subcategory',
      store_id: storeId,
      created_at: new Date(),
      updated_at: new Date(),
      billboard_id: null,
      category_id: '',
   });

   sizes.unshift(
      {
         id: 'add-new-size',
         name: 'Add new size',
         store_id: -1,
         value: '',
         created_at: new Date(),
         updated_at: new Date(),
      },
      {
         id: 'blank-id',
         name: 'N/A',
         store_id: -1,
         value: '',
         created_at: new Date(),
         updated_at: new Date(),
      },
   );

   const colors = await prismadb.color.findMany({
      where: {
         store_id: storeId,
      },
   });

   colors.unshift(
      {
         id: 'add-new-color',
         name: 'Add new color',
         store_id: -1,
         value: '',
         created_at: new Date(),
         updated_at: new Date(),
      },
      {
         id: 'blank-id',
         name: 'N/A',
         store_id: -1,
         value: '',
         created_at: new Date(),
         updated_at: new Date(),
      },
   );

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-6">
            <ProductForm
               categories={categories}
               subcategories={subcategories}
               colors={colors}
               sizes={sizes}
               initialData={product}
            />
         </div>
      </div>
   );
};

export default ProductPage;
