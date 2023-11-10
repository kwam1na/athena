'use client';

import { Button } from '@/components/ui/button';
import { MetricCard } from '@/components/ui/metric-card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatter } from '@/lib/utils';
import { useStoreCurrency } from '@/providers/currency-provider';
import { DollarSign, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ViewDataTableClient } from '../../app/(dashboard)/organizations/[organizationId]/store/[storeId]/(routes)/_components/view-data-table-client';
import { unitsSoldColumns } from '../../app/(dashboard)/organizations/[organizationId]/store/[storeId]/(routes)/_components/view-data-table-columns';
import { motion } from 'framer-motion';
import { widgetVariants } from '@/lib/constants';
interface TopSellingProductssWidgetProps {
   topSellingProducts?: Record<string, any>[];
}

export const TopSellingProductssWidget: React.FC<
   TopSellingProductssWidgetProps
> = ({ topSellingProducts }) => {
   const [_topSellingProducts, settopSellingProducts] = useState<
      Record<string, any>[] | undefined
   >(topSellingProducts);
   const [loading, setLoading] = useState(false);
   const params = useParams();

   return (
      <motion.div
         variants={widgetVariants}
         initial="hidden"
         animate="visible"
         className="space-y-8"
      >
         {!loading && _topSellingProducts && _topSellingProducts.length > 1 && (
            <>
               <p className="text-md">Top selling products this month</p>
               <ViewDataTableClient
                  data={_topSellingProducts || []}
                  columns={unitsSoldColumns}
                  type={'top-selling-products'}
               />
            </>
         )}
         {!loading &&
            _topSellingProducts &&
            _topSellingProducts.length == 0 && (
               <p className="border rounded-lg text-sm text-muted-foreground text-center p-4">
                  No data
               </p>
            )}
         {!loading && !_topSellingProducts && (
            <div className="w-full h-full border flex items-center justify-center rounded-lg p-8">
               <div className="flex flex-col gap-4">
                  <p className="text-sm text-muted-foreground">
                     Error loading top selling products
                  </p>
                  <Button variant={'ghost'}>
                     <RotateCcw className="mr-2 h-4 w-4 text-muted-foreground" />
                     <p className="text-muted-foreground">Reload</p>
                  </Button>
               </div>
            </div>
         )}
         {loading && (
            <div className="flex flex-col gap-4 w-full h-full justify-center border rounded-lg p-8">
               <Skeleton className="w-[80%] h-8" />
               <Skeleton className="w-[60%] h-8" />
            </div>
         )}
      </motion.div>
   );
};
