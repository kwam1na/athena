import prismadb from '@/lib/prismadb';
import { ProductForm } from './components/product-form';
import { getProduct } from '@/lib/repositories/productsRepository';
import { fetchCategories } from '@/lib/repositories/categoriesRepository';
import { fetchSubcategories } from '@/lib/repositories/subcategoriesRepository';

const ProductPage = async ({
   params,
}: {
   params: { productId: string; storeId: string };
}) => {
   const product = await getProduct(params.productId);
   const categories = await fetchCategories(params.storeId);
   const subcategories = await fetchSubcategories(params.storeId);

   const sizes = await prismadb.size.findMany({
      where: {
         store_id: params.storeId,
      },
   });

   categories.unshift({
      id: 'add-new-category',
      name: 'Add new category',
      store_id: params.storeId,
      created_at: new Date(),
      updated_at: new Date(),
      subcategory: [],
      products: [],
      billboard_id: null,
   });

   subcategories.unshift({
      id: 'add-new-subcategory',
      name: 'Add new subcategory',
      store_id: params.storeId,
      created_at: new Date(),
      updated_at: new Date(),
      products: [],
      billboard_id: null,
      category: {
         id: '',
         store_id: '',
         billboard_id: null,
         name: '',
         created_at: new Date(),
         updated_at: new Date(),
      },
      category_id: '',
   });

   sizes.unshift(
      {
         id: 'add-new-size',
         name: 'Add new size',
         store_id: '',
         value: '',
         created_at: new Date(),
         updated_at: new Date(),
      },
      {
         id: 'blank-id',
         name: 'N/A',
         store_id: '',
         value: '',
         created_at: new Date(),
         updated_at: new Date(),
      },
   );

   const colors = await prismadb.color.findMany({
      where: {
         store_id: params.storeId,
      },
   });

   colors.unshift(
      {
         id: 'add-new-color',
         name: 'Add new color',
         store_id: '',
         value: '',
         created_at: new Date(),
         updated_at: new Date(),
      },
      {
         id: 'blank-id',
         name: 'N/A',
         store_id: '',
         value: '',
         created_at: new Date(),
         updated_at: new Date(),
      },
   );

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-4 p-4 pt-6">
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
