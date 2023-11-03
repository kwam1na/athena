'use client';

import * as z from 'zod';
import { captureException } from '@sentry/nextjs';
import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { AlertCircle, ArrowLeft, Plus, PlusCircle, Trash } from 'lucide-react';
import {
   category,
   color,
   image,
   product,
   size,
   subcategory,
} from '@prisma/client';
import { useParams, usePathname, useRouter } from 'next/navigation';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
   Form,
   FormControl,
   FormDescription,
   FormField,
   FormItem,
   FormLabel,
   FormMessage,
} from '@/components/ui/form';
import { Separator } from '@/components/ui/separator';
import { Heading } from '@/components/ui/heading';
import { AlertModal } from '@/components/modals/alert-modal';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import ImageUpload from '@/components/ui/image-upload';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { CardContainer } from '@/components/ui/card-container';
import {
   Card,
   CardContent,
   CardDescription,
   CardHeader,
} from '@/components/ui/card';
import { cn, formatter } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useStoreCurrency } from '@/providers/currency-provider';
import { LoadingButton } from '@/components/ui/loading-button';
import {
   apiCreateProduct,
   apiDeleteProduct,
   apiUpdateProduct,
} from '@/lib/api/products';
import useReturnUrl from '@/hooks/use-get-return-url';
import { TaskAlert } from '@/components/ui/task-alert';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';

enum ActionContext {
   NONE,
   LEAVING,
   DELETING,
}

const formSchema = z.object({
   name: z.string().min(1),
   // images: z.object({ url: z.string() }).array(),
   price: z.coerce.number().min(1),
   cost_per_item: z.coerce.number().min(1),
   category_id: z.string().min(1),
   subcategory_id: z.string().min(1),
   sku: z.string().optional(),
   color_id: z.string().optional(),
   size_id: z.string().optional(),
   inventory_count: z.coerce.number().min(0).optional(),
   is_featured: z.boolean().default(false).optional(),
   is_archived: z.boolean().default(false).optional(),
});

type ProductFormValues = z.infer<typeof formSchema>;

interface ProductFormProps {
   initialData:
      | (product & {
           images: image[];
        })
      | null;
   categories: category[];
   subcategories: subcategory[];
   colors: color[];
   sizes: size[];
}

const ProductInfoCard = ({
   title,
   className,
   children,
}: {
   title: string;
   className?: string;
   children: React.ReactNode;
}) => {
   return (
      <Card className="bg-background">
         <CardHeader>
            <CardDescription>{title}</CardDescription>
         </CardHeader>
         <CardContent className={cn('grid gap-6', className)}>
            {children}
         </CardContent>
      </Card>
   );
};

export const ProductForm: React.FC<ProductFormProps> = ({
   initialData,
   categories,
   subcategories,
   sizes,
   colors,
}) => {
   const params = useParams();
   const router = useRouter();
   const pathName = usePathname();
   const baseStoreURL = useGetBaseStoreUrl();

   const { storeCurrency } = useStoreCurrency();
   const fmt = formatter(storeCurrency);

   const [open, setOpen] = useState(false);
   const [loading, setLoading] = useState(false);
   const [isMounted, setIsMounted] = useState(false);

   let initialProfit: number | undefined,
      initialMargin: number | undefined,
      initialPrice: number | undefined,
      initialCostPerItem: number | undefined;

   if (initialData) {
      initialProfit =
         parseFloat(String(initialData.price)) -
         parseFloat(String(initialData.cost_per_item));
      initialMargin = parseFloat(
         (
            (initialProfit / parseFloat(String(initialData.price))) *
            100
         ).toFixed(2),
      );
      initialProfit = parseFloat(initialProfit.toFixed(2));
      initialPrice = parseFloat(
         parseFloat(String(initialData.price)).toFixed(2),
      );
      initialCostPerItem = parseFloat(
         parseFloat(String(initialData.cost_per_item)).toFixed(2),
      );
   }

   const [profit, setProfit] = useState(initialProfit || 0);
   const [margin, setMargin] = useState(initialMargin || 0);

   const [price, setPrice] = useState(initialPrice || 0);
   const [costPerItem, setCostPerItem] = useState(initialCostPerItem || 0);

   const [actionContext, setActionContext] = useState(ActionContext.NONE);

   const { toast } = useToast();

   const title = initialData ? 'Edit product' : 'Create product';
   const description = initialData ? 'Edit a product.' : 'Add a new product';
   const action = initialData ? 'Save changes' : 'Create';
   const loadingAction = loading ? (initialData ? 'Saving' : 'Creating') : '';
   const buttonText = loading ? loadingAction : action;

   const defaultValues: Record<string, any> = initialData
      ? {
           ...initialData,
           price: parseFloat(String(initialData?.price)),
           cost_per_item: parseFloat(String(initialData?.cost_per_item)),
           size_id: initialData.size_id || '',
           color_id: initialData.color_id || '',
        }
      : {
           name: '',
           //   images: [],
           price: Number('a'),
           cost_per_item: Number('a'),
           inventory_count: 1,
           category_id: '',
           subcategory_id: '',
           sku: '',
           is_featured: false,
           is_archived: false,
        };

   const form = useForm<ProductFormValues>({
      resolver: zodResolver(formSchema),
      // @ts-ignore
      defaultValues,
   });

   const hasFormChanged = (formValues: any) => {
      return Object.keys(defaultValues).some((key) => {
         // if (formValues[key] !== defaultValues[key]) {
         //    console.log('different:', key);
         //    console.log('different:', formValues[key], defaultValues[key]);
         // }
         if (
            (Number.isNaN(formValues[key]) &&
               Number.isNaN(defaultValues[key])) ||
            [
               'created_at',
               'updated_at',
               'images',
               'category',
               'subcategory',
            ].includes(key)
         ) {
            return false;
         }
         return formValues[key] !== defaultValues[key];
      });
   };

   const [hasChanges, setHasChanges] = useState(
      hasFormChanged(form.getValues()),
   );

   const watchedValues = form.watch();

   useEffect(() => {
      setHasChanges(hasFormChanged(watchedValues));
   }, [watchedValues]);

   useEffect(() => {
      setIsMounted(true);
   }, []);

   if (!isMounted) {
      return null;
   }

   const calculateMetrics = (value: number, type: 'price' | 'cpi') => {
      let margin = 0,
         profit = 0;

      if (type == 'price') {
         profit = value - costPerItem;
         margin = (profit / value) * 100;
      } else {
         profit = price - value;
         margin = (profit / price) * 100;
      }

      setProfit(parseFloat(profit.toFixed(2)));
      setMargin(parseFloat(margin.toFixed(2)));
   };

   const getReturnUrl = useReturnUrl('/inventory/products');

   const onSubmit = async (data: ProductFormValues) => {
      const cleanedUpData = {
         ...data,
         size_id: data.size_id == 'blank-id' ? null : data.size_id,
         color_id: data.color_id == 'blank-id' ? null : data.color_id,
      };

      const returnUrl = getReturnUrl();

      try {
         setLoading(true);
         if (initialData) {
            await apiUpdateProduct(
               params.productId,
               params.storeId,
               cleanedUpData,
            );
         } else {
            await apiCreateProduct(params.storeId, cleanedUpData);
         }
         toast({
            title: `Product '${data.name}' ${
               initialData ? 'updated' : 'added'
            }.`,
         });
         router.refresh();
         router.push(returnUrl);
      } catch (error: any) {
         captureException(error);
         toast({
            title: 'Something went wrong adding this product. Try again.',
         });
      } finally {
         setLoading(false);
      }
   };

   const onDelete = async () => {
      try {
         setLoading(true);
         await apiDeleteProduct(params.productId, params.storeId);
         router.refresh();
         router.push(`${baseStoreURL}/inventory/products`);
         toast({
            title: 'Product deleted.',
         });
      } catch (error: any) {
         captureException(error);
         toast({
            title: 'Something went wrong deleting this product. Try again.',
         });
      } finally {
         setLoading(false);
         setOpen(false);
      }
   };

   // Helper function to get the current route without search parameters
   const getCurrentRoute = () => {
      const currentURL = new URL(window.location.href);
      return currentURL.pathname;
   };

   const saveReturnUrlIfNeeded = () => {
      const currentURL = new URL(window.location.href);
      const currentReturnURL = currentURL.searchParams.get('return_url');

      // If a return_url is found and no originalReturnURL is set, save it to session storage.
      if (currentReturnURL && !sessionStorage.getItem('originalReturnURL')) {
         sessionStorage.setItem('originalReturnURL', currentReturnURL);
      }
   };

   // useEffect(() => {
   //    // console.log('back here..');
   //    const originalReturnURL = sessionStorage.getItem('originalReturnURL');

   //    if (originalReturnURL) {
   //       sessionStorage.removeItem('originalReturnURL'); // Clear after use
   //       console.log('originalReturnURL:', originalReturnURL);
   //    }
   // }, []);

   const Alerts = () => {
      saveReturnUrlIfNeeded();

      const hasAddedCategory = !(
         categories.length == 1 && categories[0].id == 'add-new-category'
      );
      const hasAddedSubcategory = !(
         subcategories.length == 1 &&
         subcategories[0].id == 'add-new-subcategory'
      );

      return (
         <>
            {!hasAddedCategory && (
               <TaskAlert
                  title="No categories found"
                  description="To proceed, please add a category."
                  action={{
                     type: 'navigate',
                     ctaText: 'Add category',
                     route: `${baseStoreURL}/inventory/categories/new?return_url=${pathName}`,
                  }}
               />
            )}
            {!hasAddedSubcategory && (
               <TaskAlert
                  title="No subcategories found"
                  description="Add a subcategory to create a product."
                  action={{
                     type: 'navigate',
                     ctaText: 'Add subcategory',
                     route: `${baseStoreURL}/inventory/subcategories/new?return_url=${pathName}`,
                  }}
               />
            )}
         </>
      );
   };

   let alertTitle,
      alertDescription,
      actionFn: () => void = onDelete;

   switch (actionContext) {
      case ActionContext.LEAVING:
         alertTitle = 'Changes not saved';
         alertDescription = 'Leaving will discard entered data.';
         actionFn = () => router.back();
         break;

      case ActionContext.DELETING:
         alertTitle = `Delete ${initialData?.name}?`;
         alertDescription = 'This action cannot be undone.';
         actionFn = onDelete;
         break;

      default:
         break;
   }

   // Trigger these somewhere in your logic
   const promptLeaving = () => {
      if (hasChanges) {
         setActionContext(ActionContext.LEAVING);
         setOpen(true);
      } else {
         router.back();
      }
   };

   const promptDeleting = () => {
      setActionContext(ActionContext.DELETING);
      setOpen(true);
   };

   return (
      <>
         <AlertModal
            isOpen={open}
            onClose={() => {
               setOpen(false);
               setActionContext(ActionContext.NONE);
            }}
            onConfirm={actionFn}
            title={alertTitle}
            description={alertDescription}
            loading={loading}
         />
         <div className="flex flex-col space-y-6">
            <div>
               <Button variant={'outline'} onClick={promptLeaving}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
               </Button>
            </div>
            <Alerts />
         </div>
         <div className="flex items-center justify-between">
            <Heading title={title} description={description} />
            {initialData && (
               <Button
                  disabled={loading}
                  variant="destructive"
                  onClick={promptDeleting}
               >
                  <Trash className="mr-2 h-4 w-4" /> Delete
               </Button>
            )}
         </div>
         <Separator />
         <Form {...form}>
            <form
               onSubmit={form.handleSubmit(onSubmit)}
               className="space-y-8 w-full"
            >
               {/* <FormField
                  control={form.control}
                  name="images"
                  render={({ field }) => (
                     <FormItem>
                        <FormLabel>Images</FormLabel>
                        <FormControl>
                           <ImageUpload
                              value={field.value.map((image) => image.url)}
                              disabled={loading}
                              onChange={(url) =>
                                 field.onChange([...field.value, { url }])
                              }
                              onRemove={(url) =>
                                 field.onChange([
                                    ...field.value.filter(
                                       (current) => current.url !== url,
                                    ),
                                 ])
                              }
                           />
                        </FormControl>
                        <FormMessage />
                     </FormItem>
                  )}
               /> */}
               <div className="md:grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                  <CardContainer>
                     <ProductInfoCard title="Product information">
                        <FormField
                           control={form.control}
                           name="name"
                           render={({ field }) => (
                              <FormItem>
                                 <FormLabel>Name</FormLabel>
                                 <FormControl>
                                    <Input
                                       disabled={loading}
                                       placeholder="Product name"
                                       {...field}
                                    />
                                 </FormControl>
                                 <FormMessage />
                              </FormItem>
                           )}
                        />
                        <div className="grid grid-cols-2 gap-6">
                           <FormField
                              control={form.control}
                              name="price"
                              render={({ field }) => (
                                 <FormItem>
                                    <FormLabel> List price</FormLabel>
                                    <FormControl>
                                       <Input
                                          type="number"
                                          disabled={loading}
                                          placeholder="9.99"
                                          {...field}
                                          onChange={(e) => {
                                             field.onChange(e);
                                             setPrice(
                                                parseFloat(e.target.value),
                                             );
                                             calculateMetrics(
                                                parseFloat(e.target.value),
                                                'price',
                                             );
                                          }}
                                       />
                                    </FormControl>
                                    <FormMessage />
                                 </FormItem>
                              )}
                           />
                           <FormField
                              control={form.control}
                              name="cost_per_item"
                              render={({ field }) => (
                                 <FormItem>
                                    <FormLabel>Cost</FormLabel>
                                    <FormControl>
                                       <Input
                                          type="number"
                                          disabled={loading}
                                          placeholder="9.99"
                                          {...field}
                                          onChange={(e) => {
                                             field.onChange(e);
                                             setCostPerItem(
                                                parseFloat(e.target.value),
                                             );
                                             calculateMetrics(
                                                parseFloat(e.target.value),
                                                'cpi',
                                             );
                                          }}
                                       />
                                    </FormControl>
                                    <FormMessage />
                                 </FormItem>
                              )}
                           />
                        </div>
                        <div className="grid grid-cols-2">
                           <div className="grid grid-rows-2">
                              <p className="text-sm text-muted-foreground">
                                 Profit
                              </p>
                              <p className="text-sm">
                                 {isNaN(profit) ? '--' : fmt.format(profit)}
                              </p>
                           </div>

                           <div className="grid grid-rows-2">
                              <p className="text-sm text-muted-foreground">
                                 Margin
                              </p>
                              <p className="text-sm">
                                 {isNaN(margin) ? '--' : `${margin}%`}
                              </p>
                           </div>
                        </div>
                     </ProductInfoCard>
                  </CardContainer>
                  <CardContainer>
                     <ProductInfoCard title="Inventory" className="grid-cols-2">
                        <FormField
                           control={form.control}
                           name="category_id"
                           render={({ field }) => (
                              <FormItem>
                                 <FormLabel>Category</FormLabel>
                                 <Select
                                    disabled={loading}
                                    onValueChange={(value: string) => {
                                       if (value == 'add-new-category') {
                                          saveReturnUrlIfNeeded();
                                          router.push(
                                             `${baseStoreURL}/inventory/categories/new?return_url=${pathName}`,
                                          );
                                       } else {
                                          field.onChange(value);
                                       }
                                    }}
                                    value={field.value}
                                    defaultValue={field.value}
                                 >
                                    <FormControl>
                                       <SelectTrigger>
                                          <SelectValue
                                             defaultValue={field.value}
                                             placeholder="Select a category"
                                          />
                                       </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                       {categories.map((category) => (
                                          <SelectItem
                                             key={category.id}
                                             value={category.id}
                                          >
                                             {category.id.includes(
                                                'add-new',
                                             ) ? (
                                                <div className="flex items-center">
                                                   <PlusCircle className="mr-2 h-4 w-4" />
                                                   <p className="text-primary">
                                                      Add new category
                                                   </p>
                                                </div>
                                             ) : (
                                                category.name
                                             )}
                                          </SelectItem>
                                       ))}
                                    </SelectContent>
                                 </Select>
                                 <FormMessage />
                              </FormItem>
                           )}
                        />
                        <FormField
                           control={form.control}
                           name="subcategory_id"
                           render={({ field }) => (
                              <FormItem>
                                 <FormLabel>Subcategory</FormLabel>
                                 <Select
                                    disabled={loading}
                                    onValueChange={(value: string) => {
                                       if (value == 'add-new-subcategory') {
                                          saveReturnUrlIfNeeded();
                                          router.push(
                                             `${baseStoreURL}/inventory/subcategories/new?return_url=${pathName}`,
                                          );
                                       } else {
                                          field.onChange(value);
                                       }
                                    }}
                                    value={field.value}
                                    defaultValue={field.value}
                                 >
                                    <FormControl>
                                       <SelectTrigger>
                                          <SelectValue
                                             defaultValue={field.value}
                                             placeholder="Select a subcategory"
                                          />
                                       </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                       {subcategories.map((subcategory) => (
                                          <SelectItem
                                             key={subcategory.id}
                                             value={subcategory.id}
                                          >
                                             {subcategory.id.includes(
                                                'add-new',
                                             ) ? (
                                                <div className="flex items-center">
                                                   <PlusCircle className="mr-2 h-4 w-4" />
                                                   <p className="text-primary">
                                                      Add new subcategory
                                                   </p>
                                                </div>
                                             ) : (
                                                subcategory.name
                                             )}
                                          </SelectItem>
                                       ))}
                                    </SelectContent>
                                 </Select>
                                 <FormMessage />
                              </FormItem>
                           )}
                        />
                        <FormField
                           control={form.control}
                           name="inventory_count"
                           render={({ field }) => (
                              <FormItem>
                                 <FormLabel>Count</FormLabel>
                                 <FormControl>
                                    <Input
                                       type="number"
                                       disabled={loading}
                                       placeholder="0"
                                       {...field}
                                    />
                                 </FormControl>
                                 <FormMessage />
                              </FormItem>
                           )}
                        />
                        <FormField
                           control={form.control}
                           name="sku"
                           render={({ field }) => (
                              <FormItem>
                                 <FormLabel>SKU</FormLabel>
                                 <FormControl>
                                    <Input
                                       disabled={loading}
                                       placeholder="Product SKU"
                                       {...field}
                                    />
                                 </FormControl>
                                 <FormDescription>
                                    auto-generated if left blank
                                 </FormDescription>
                                 <FormMessage />
                              </FormItem>
                           )}
                        />
                     </ProductInfoCard>
                  </CardContainer>

                  <CardContainer>
                     <ProductInfoCard title="Attributes (optional)">
                        <FormField
                           control={form.control}
                           name="size_id"
                           render={({ field }) => (
                              <FormItem>
                                 <FormLabel>Size</FormLabel>
                                 <Select
                                    disabled={loading}
                                    onValueChange={(value: string) => {
                                       if (value == 'add-new-size') {
                                          // saveReturnUrlIfNeeded();
                                          router.push(
                                             `${baseStoreURL}/inventory/sizes/new?return_url=${pathName}`,
                                          );
                                       } else {
                                          field.onChange(value);
                                       }
                                    }}
                                    value={field.value}
                                    defaultValue={field.value}
                                 >
                                    <FormControl>
                                       <SelectTrigger>
                                          <SelectValue
                                             defaultValue={field.value}
                                             placeholder="Select a size"
                                          />
                                       </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                       {sizes.map((size) => (
                                          <SelectItem
                                             key={size.id}
                                             value={size.id}
                                          >
                                             {size.id.includes('add-new') ? (
                                                <div className="flex items-center">
                                                   <PlusCircle className="mr-2 h-4 w-4" />
                                                   <p className="text-primary">
                                                      Add new size
                                                   </p>
                                                </div>
                                             ) : (
                                                size.name
                                             )}
                                          </SelectItem>
                                       ))}
                                    </SelectContent>
                                 </Select>
                                 <FormMessage />
                              </FormItem>
                           )}
                        />
                        <FormField
                           control={form.control}
                           name="color_id"
                           render={({ field }) => (
                              <FormItem>
                                 <FormLabel>Color</FormLabel>
                                 <Select
                                    disabled={loading}
                                    onValueChange={(value: string) => {
                                       if (value == 'add-new-color') {
                                          saveReturnUrlIfNeeded();
                                          router.push(
                                             `${baseStoreURL}/inventory/colors/new?return_url=${pathName}`,
                                          );
                                       } else {
                                          field.onChange(value);
                                       }
                                    }}
                                    value={field.value}
                                    defaultValue={field.value}
                                 >
                                    <FormControl>
                                       <SelectTrigger>
                                          <SelectValue
                                             defaultValue={field.value}
                                             placeholder="Select a color"
                                          />
                                       </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                       {colors.map((color) => (
                                          <SelectItem
                                             key={color.id}
                                             value={color.id}
                                          >
                                             {color.id.includes('add-new') ? (
                                                <div className="flex items-center">
                                                   <PlusCircle className="mr-2 h-4 w-4" />
                                                   <p className="text-primary">
                                                      Add new color
                                                   </p>
                                                </div>
                                             ) : (
                                                color.name
                                             )}
                                          </SelectItem>
                                       ))}
                                    </SelectContent>
                                 </Select>
                                 <FormMessage />
                              </FormItem>
                           )}
                        />
                     </ProductInfoCard>
                  </CardContainer>

                  {/* <FormField
                     control={form.control}
                     name="isFeatured"
                     render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                           <FormControl>
                              <Checkbox
                                 checked={field.value}
                                 // @ts-ignore
                                 onCheckedChange={field.onChange}
                              />
                           </FormControl>
                           <div className="space-y-1 leading-none">
                              <FormLabel>Featured</FormLabel>
                              <FormDescription>
                                 This product will appear on the home page
                              </FormDescription>
                           </div>
                        </FormItem>
                     )}
                  /> */}
                  <FormField
                     control={form.control}
                     name="is_archived"
                     render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                           <FormControl>
                              <Checkbox
                                 checked={field.value}
                                 // @ts-ignore
                                 onCheckedChange={field.onChange}
                              />
                           </FormControl>
                           <div className="space-y-1 leading-none">
                              <FormLabel>Archived</FormLabel>
                              <FormDescription>
                                 Excludes this product from stock count.
                              </FormDescription>
                           </div>
                        </FormItem>
                     )}
                  />
               </div>
               <LoadingButton
                  isLoading={loading}
                  disabled={loading}
                  className="ml-auto"
                  type="submit"
               >
                  {buttonText}
               </LoadingButton>
            </form>
         </Form>
      </>
   );
};
