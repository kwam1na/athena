'use client';

import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { CardContainer } from '@/components/ui/card-container';
import { Heading } from '@/components/ui/heading';
import InfoCard from '@/components/ui/info-card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
   InStockBadge,
   LowStockBadge,
   SoldOutBadge,
} from '@/components/ui/stock-status-badge';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';
import { formatter } from '@/lib/utils';
import { useStoreCurrency } from '@/providers/currency-provider';
import { image, product } from '@prisma/client';
import { ArrowLeft, Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { mainContainerVariants, widgetVariants } from '@/lib/constants';

interface ProductPageProps {
   product:
      | (product & {
           images: image[];
        })
      | null;
   low_stock_threshold?: number;
}

const ProductDetail = ({
   title,
   detail,
}: {
   title: string;
   detail?: string | number | React.ReactNode;
}) => {
   return (
      <div className="flex flex-col gap-4">
         <Label className="text-muted-foreground">{title}</Label>
         {typeof detail === 'number' || typeof detail === 'string' ? (
            <p className="text-md">{detail}</p>
         ) : (
            detail
         )}
      </div>
   );
};

const StockStatus = ({
   inventoryCount,
   lowStockThreshold,
}: {
   inventoryCount?: number;
   lowStockThreshold?: number;
}) => {
   if (typeof inventoryCount !== 'number' || !lowStockThreshold) return null;

   if (inventoryCount <= 0) {
      return <SoldOutBadge />;
   }

   if (inventoryCount <= lowStockThreshold) {
      return <LowStockBadge />;
   }

   return <InStockBadge />;
};

export const ViewProductPage: React.FC<ProductPageProps> = ({
   product,
   low_stock_threshold,
}) => {
   const router = useRouter();
   const baseStoreURL = useGetBaseStoreUrl();
   const { storeCurrency, loading: isLoadingCurrency } = useStoreCurrency();
   const fmt = formatter(storeCurrency);

   const calculateMetrics = (type: 'profit' | 'margin', value: number) => {
      let result = 0;
      if (type === 'profit') {
         result = value - (product?.cost_per_item || 0);
      }

      if (type === 'margin') {
         result = ((value - (product?.cost_per_item || 0)) / value) * 100;
      }

      return parseFloat(result.toFixed(2));
   };

   return (
      <>
         <motion.div
            className="flex justify-between"
            variants={widgetVariants}
            initial="hidden"
            animate="visible"
         >
            <div className="flex flex-col space-y-6 w-full">
               <div className="flex space-x-4 items-center">
                  <Button variant={'outline'} onClick={() => router.back()}>
                     <ArrowLeft className="mr-2 h-4 w-4" />
                  </Button>
                  <Label className="text-lg">Product details</Label>
               </div>
            </div>

            <div className="space-x-4 flex items-center">
               <Button
                  variant={'outline'}
                  onClick={() =>
                     router.push(
                        `${baseStoreURL}/inventory/products/${product?.id}/edit`,
                     )
                  }
               >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
               </Button>
            </div>
         </motion.div>

         <Separator />

         <motion.div
            className="md:grid md:grid-cols-2 lg:grid-cols-3 gap-8"
            variants={mainContainerVariants}
            initial="hidden"
            animate="visible"
         >
            <CardContainer>
               <InfoCard title="Product information">
                  <div className="flex flex-col gap-8">
                     <ProductDetail title="Name" detail={product?.name} />

                     <div className="grid grid-cols-2">
                        <ProductDetail
                           title="Price"
                           detail={product?.price && fmt.format(product?.price)}
                        />

                        <ProductDetail
                           title="Cost"
                           detail={
                              product?.cost_per_item &&
                              fmt.format(product?.cost_per_item)
                           }
                        />
                     </div>

                     <div className="grid grid-cols-2">
                        {product?.price && (
                           <ProductDetail
                              title="Profit"
                              detail={fmt.format(
                                 calculateMetrics('profit', product?.price),
                              )}
                           />
                        )}

                        {product?.price && (
                           <ProductDetail
                              title="Margin"
                              detail={`${calculateMetrics(
                                 'margin',
                                 product?.price,
                              )}%`}
                           />
                        )}
                     </div>
                  </div>
               </InfoCard>
            </CardContainer>

            <CardContainer>
               <InfoCard title="Inventory">
                  <div className="flex flex-col gap-8">
                     <div className="grid grid-cols-2">
                        <ProductDetail
                           title="Category"
                           // @ts-expect-error: fix type to include category
                           detail={product?.category?.name || 'N/A'}
                        />
                        <ProductDetail
                           title="Subcategory"
                           // @ts-expect-error: fix type to include category
                           detail={product?.subcategory?.name || 'N/A'}
                        />
                     </div>

                     <div className="grid grid-cols-2">
                        <ProductDetail
                           title="Inventory count"
                           detail={product?.inventory_count}
                        />
                        <ProductDetail
                           title="SKU"
                           detail={product?.sku || 'N/A'}
                        />
                     </div>

                     {typeof product?.inventory_count == 'number' &&
                        typeof low_stock_threshold == 'number' && (
                           <ProductDetail
                              title="Availability"
                              detail={
                                 <div>
                                    <StockStatus
                                       inventoryCount={product?.inventory_count}
                                       lowStockThreshold={low_stock_threshold}
                                    />
                                 </div>
                              }
                           />
                        )}
                  </div>
               </InfoCard>
            </CardContainer>
         </motion.div>
      </>
   );
};
