'use client';

import * as z from 'zod';
import { captureException, init } from '@sentry/nextjs';
import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { ArrowLeft, Info, PlusCircle, Trash } from 'lucide-react';
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
import { ActionModal } from '@/components/modals/action-modal';
import { ProductsAutosaver } from '../../utils/products-autosaver';
import { Skeleton } from '@/components/ui/skeleton';
import { motion } from 'framer-motion';
import { widgetVariants } from '@/lib/constants';
import {
   Tooltip,
   TooltipContent,
   TooltipProvider,
   TooltipTrigger,
} from '@/components/ui/tooltip';
import { InfoCircledIcon } from '@radix-ui/react-icons';

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

   const { storeCurrency, loading: isLoadingCurrency } = useStoreCurrency();
   const fmt = formatter(storeCurrency);

   const [open, setOpen] = useState(false);
   const [loading, setLoading] = useState(false);
   const [isAutosavedModalOpen, setIsAutosavedModalOpen] = useState(false);
   const [isMounted, setIsMounted] = useState(false);
   const [validSubcategories, setValidSubcategories] = useState<subcategory[]>(
      initialData
         ? subcategories.filter(
              (subcategory) =>
                 subcategory.category_id === initialData.category_id ||
                 subcategory.id === 'add-new-subcategory',
           )
         : subcategories,
   );
   const [invalidatedSubcategory, setInvalidatedSubcategory] = useState(false);

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

   const entryAction = initialData ? 'edit' : 'new';
   const productAutosaver = new ProductsAutosaver(params.storeId, entryAction);

   const searchParams = new URLSearchParams(window.location.search);
   const productName = searchParams.get('query');

   const defaultValues: Record<string, any> = initialData
      ? {
           ...initialData,
           price: parseFloat(String(initialData?.price)),
           cost_per_item: parseFloat(String(initialData?.cost_per_item)),
           subcategory_id: invalidatedSubcategory
              ? ''
              : initialData.subcategory_id,
           size_id: initialData.size_id || '',
           color_id: initialData.color_id || '',
        }
      : {
           name: productName || '',
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

   /**
    * Autosave product
    */
   const autosaveProduct = () => {
      productAutosaver.save(form.getValues());
   };

   /**
    * Calculate profit and margin
    */
   const calculateMetrics = (
      value: number,
      type: 'price' | 'cpi',
      opts?: { price: number; cpi: number },
   ) => {
      let margin = 0,
         profit = 0;

      const _price = opts?.price || price;
      const _cpi = opts?.cpi || costPerItem;

      if (type == 'price') {
         profit = value - _cpi;
         margin = (profit / value) * 100;
      } else {
         profit = _price - value;
         margin = (profit / _price) * 100;
      }

      setProfit(parseFloat(profit.toFixed(2)));
      setMargin(parseFloat(margin.toFixed(2)));
   };

   /**
    * Discard autosaved product
    */
   const discardAutosavedProduct = () => {
      productAutosaver.clearAll();
      setIsAutosavedModalOpen(false);
   };

   const getReturnUrl = useReturnUrl(`/inventory/products`);

   /**
    * Delete product handler
    */
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
         productAutosaver.clearAll();
         setLoading(false);
         setOpen(false);
      }
   };

   /**
    * Submit product handler
    */
   const onSubmit = async (data: ProductFormValues) => {
      const cleanedUpData = {
         ...data,
         size_id: data.size_id == 'blank-id' ? null : data.size_id,
         color_id: data.color_id == 'blank-id' ? null : data.color_id,
         organization_id: parseInt(params.organizationId),
      };

      let returnUrl = getReturnUrl();
      const { return_url } = JSON.parse(localStorage.getItem(pathName) || '{}');

      if (return_url && returnUrl != return_url) {
         returnUrl = return_url;
      }

      if (invalidatedSubcategory) {
         form.setError('subcategory_id', {
            type: 'custom',
            message: 'Please select a subcategory.',
         });
         return;
      }

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
         productAutosaver.clearAll();
         localStorage.removeItem(pathName);
         setLoading(false);
      }
   };

   /**
    * Prompt leaving
    */
   const promptLeaving = () => {
      if (hasChanges && initialData) {
         setActionContext(ActionContext.LEAVING);
         setOpen(true);
      } else if (!initialData) {
         const autosavedProduct = productAutosaver.getAll();
         if (Object.keys(autosavedProduct).length > 0) {
            toast({
               title: 'Autosaved',
            });
         }
         router.back();
      } else {
         router.back();
      }
   };

   /**
    * Prompt deleting
    */
   const promptDeleting = () => {
      setActionContext(ActionContext.DELETING);
      setOpen(true);
   };

   /**
    * Save return_url to local storage
    */
   const saveReturnUrlToLocalStorage = () => {
      const url = window.location.href;
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      let return_url = urlObj.searchParams.get('return_url');

      // If return_url exists, append the remaining query params to it
      if (return_url) {
         urlObj.searchParams.delete('return_url');

         const remainingQueryParams = urlObj.searchParams.toString();
         return_url +=
            (return_url.includes('?') ? '&' : '?') + remainingQueryParams;
      }

      localStorage.setItem(pathname, JSON.stringify({ return_url }));
      autosaveProduct();
   };

   /**
    * Update return_url to include repopulate query param
    */
   const updateReturnURL = () => {
      const draftProduct = productAutosaver.getAll();

      if (Object.keys(draftProduct).length > 0) {
         return `&repopulate=true`;
      }
      return '';
   };

   /**
    * Use autosaved product
    */
   const useAutosavedProduct = () => {
      const draftProduct = productAutosaver.getAll();
      form.reset(draftProduct);

      setValidSubcategories(
         subcategories.filter(
            (subcategory) =>
               subcategory.category_id == draftProduct.category_id ||
               subcategory.id == 'add-new-subcategory',
         ),
      );

      const opts = {
         price: parseFloat(draftProduct.price),
         cpi: parseFloat(draftProduct.cost_per_item),
      };
      setPrice(parseFloat(draftProduct.price));
      setCostPerItem(parseFloat(draftProduct.cost_per_item));
      calculateMetrics(parseFloat(draftProduct.price), 'price', opts);
      calculateMetrics(parseFloat(draftProduct.cost_per_item), 'cpi', opts);
      setIsAutosavedModalOpen(false);
   };

   useEffect(() => {
      const autosavedProduct = productAutosaver.getAll();
      if (!initialData && Object.keys(autosavedProduct).length > 0) {
         setIsAutosavedModalOpen(true);
      }

      const searchParams = new URLSearchParams(window.location.search);
      const repopulate = searchParams.get('repopulate');

      searchParams.delete('repopulate');

      if (initialData && !repopulate) {
         productAutosaver.save(form.getValues());
      }

      if (Object.keys(autosavedProduct).length > 0) {
         const urlWithoutParams = window.location.pathname;
         if (searchParams.toString()) {
            window.history.replaceState(
               null,
               '',
               `?${searchParams.toString()}`,
            );
         } else {
            window.history.replaceState(null, '', urlWithoutParams);
         }

         if (repopulate) {
            useAutosavedProduct();
         }
      }
   }, []);

   useEffect(() => {
      if (!localStorage.getItem(pathName)) saveReturnUrlToLocalStorage();
   }, []);

   useEffect(() => {
      setHasChanges(hasFormChanged(watchedValues));
   }, [watchedValues]);

   useEffect(() => {
      setIsMounted(true);
   }, []);

   if (!isMounted) {
      return null;
   }

   const Alerts = () => {
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
                     route: `${baseStoreURL}/inventory/categories/new?return_url=${pathName}${updateReturnURL()}`,
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
                     route: `${baseStoreURL}/inventory/subcategories/new?return_url=${pathName}${updateReturnURL()}`,
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
         actionFn = () => {
            productAutosaver.clearAll();
            router.back();
         };
         break;

      case ActionContext.DELETING:
         alertTitle = `Delete ${initialData?.name}?`;
         alertDescription = 'This action cannot be undone.';
         actionFn = onDelete;
         break;

      default:
         break;
   }

   return (
      <motion.div
         className="space-y-6"
         variants={widgetVariants}
         initial="hidden"
         animate="visible"
      >
         <ActionModal
            isOpen={isAutosavedModalOpen}
            title="Unfinished product detected"
            description="You were previously creating a product. Do you want to continue editing it or start over?"
            declineText="Discard"
            onConfirm={() => useAutosavedProduct()}
            onClose={discardAutosavedProduct}
         />
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

         <div className="flex justify-between">
            <div className="flex flex-col space-y-6">
               <div className="flex space-x-4">
                  <Button variant={'outline'} onClick={promptLeaving}>
                     <ArrowLeft className="mr-2 h-4 w-4" />
                  </Button>
                  <Heading title={title} description={description} />
               </div>
               <Alerts />
            </div>
            <div className="flex items-center">
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
                                       onChange={(e) => {
                                          field.onChange(e);
                                          autosaveProduct();
                                       }}
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
                                             autosaveProduct();
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
                                             autosaveProduct();
                                          }}
                                       />
                                    </FormControl>
                                    <FormMessage />
                                 </FormItem>
                              )}
                           />
                        </div>
                        <div className="grid grid-cols-2">
                           <div className="grid grid-rows-2 space-y-2">
                              <TooltipProvider>
                                 <Tooltip>
                                    <TooltipTrigger asChild>
                                       <div className="flex items-center">
                                          <p className="text-sm text-muted-foreground">
                                             Profit
                                          </p>
                                          <InfoCircledIcon className="h-4 w-4 ml-1 text-muted-foreground" />
                                       </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                       <p>
                                          Profit is the difference between the
                                          list price and the cost. It indicates
                                          the actual monetary gain from a sale.
                                       </p>
                                    </TooltipContent>
                                 </Tooltip>
                              </TooltipProvider>
                              {isLoadingCurrency && (
                                 <Skeleton className="w-[80px] h-[24px]" />
                              )}
                              {!isLoadingCurrency && (
                                 <p className="text-sm">
                                    {isNaN(profit) ? '--' : fmt.format(profit)}
                                 </p>
                              )}
                           </div>

                           <div className="grid grid-rows-2 space-y-2">
                              <TooltipProvider>
                                 <Tooltip>
                                    <TooltipTrigger asChild>
                                       <div className="flex items-center">
                                          <p className="text-sm text-muted-foreground">
                                             Margin
                                          </p>
                                          <InfoCircledIcon className="h-4 w-4 ml-1 text-muted-foreground" />
                                       </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                       <p>
                                          Margin is calculated as the difference
                                          between the list price and the cost,
                                          divided by the list price, expressed
                                          as a percentage. It represents the
                                          portion of the list price that turns
                                          into profit.
                                       </p>
                                    </TooltipContent>
                                 </Tooltip>
                              </TooltipProvider>
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
                                          router.push(
                                             `${baseStoreURL}/inventory/categories/new?return_url=${pathName}${updateReturnURL()}`,
                                          );
                                       } else {
                                          field.onChange(value);
                                          form.resetField('subcategory_id');

                                          if (initialData) {
                                             if (
                                                initialData.category_id !==
                                                value
                                             ) {
                                                setInvalidatedSubcategory(true);
                                             } else {
                                                setInvalidatedSubcategory(
                                                   false,
                                                );
                                             }
                                          }

                                          setValidSubcategories(
                                             subcategories.filter(
                                                (subcategory) =>
                                                   subcategory.category_id ==
                                                      value ||
                                                   subcategory.id ==
                                                      'add-new-subcategory',
                                             ),
                                          );
                                          autosaveProduct();
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
                                          router.push(
                                             `${baseStoreURL}/inventory/subcategories/new?return_url=${pathName}${updateReturnURL()}`,
                                          );
                                       } else {
                                          field.onChange(value);
                                          autosaveProduct();

                                          if (
                                             initialData &&
                                             invalidatedSubcategory
                                          ) {
                                             setInvalidatedSubcategory(false);
                                          }
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
                                       {validSubcategories.map(
                                          (subcategory) => (
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
                                          ),
                                       )}
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
                                       onChange={(e) => {
                                          field.onChange(e);
                                          autosaveProduct();
                                       }}
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
                                       onChange={(e) => {
                                          field.onChange(e);
                                          autosaveProduct();
                                       }}
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
                                          router.push(
                                             `${baseStoreURL}/inventory/sizes/new?return_url=${pathName}${updateReturnURL()}`,
                                          );
                                       } else {
                                          field.onChange(value);
                                          autosaveProduct();
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
                                          router.push(
                                             `${baseStoreURL}/inventory/colors/new?return_url=${pathName}${updateReturnURL()}`,
                                          );
                                       } else {
                                          field.onChange(value);
                                          autosaveProduct();
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
                                 onCheckedChange={(e) => {
                                    field.onChange(e);
                                    autosaveProduct();
                                 }}
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
      </motion.div>
   );
};
