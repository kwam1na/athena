'use client';

import { Button } from '@/components/ui/button';
import { MetricCard } from '@/components/ui/metric-card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatter } from '@/lib/utils';
import { useStoreCurrency } from '@/providers/currency-provider';
import { Bell, DollarSign, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ViewDataTableClient } from '../../app/(dashboard)/organizations/[organizationId]/store/[storeId]/(routes)/_components/view-data-table-client';
import { lowStockProductsColumns } from '../../app/(dashboard)/organizations/[organizationId]/store/[storeId]/(routes)/_components/view-data-table-columns';
import { motion } from 'framer-motion';
import { widgetVariants } from '@/lib/constants';
interface LowStockProductsWidgetProps {
   lowStockProducts?: Record<string, any>[];
   lowStockThreshold?: number;
}

export const LowStockProductsWidget: React.FC<LowStockProductsWidgetProps> = ({
   lowStockProducts,
   lowStockThreshold,
}) => {
   const [_lowStockProducts, setLowStockProducts] = useState<
      Record<string, any>[] | undefined
   >(lowStockProducts);
   const [loading, setLoading] = useState(false);
   const params = useParams();

   return (
      <motion.div
         variants={widgetVariants}
         initial="hidden"
         animate="visible"
         className="space-y-8"
      >
         {!loading && _lowStockProducts && _lowStockProducts.length > 0 && (
            <div className="border rounded-lg p-8 space-y-8">
               <div className="flex items-center">
                  <p className="text-md">Stock alerts</p>
                  <Bell className="ml-auto h-4 w-4 text-muted-foreground" />
               </div>
               <ViewDataTableClient
                  data={_lowStockProducts || []}
                  columns={lowStockProductsColumns}
                  additionalData={{ low_stock_threshold: lowStockThreshold }}
                  type="low-stock-products"
               />
            </div>
         )}
         {!loading && _lowStockProducts && _lowStockProducts.length == 0 && (
            <p className="border rounded-lg text-sm text-muted-foreground text-center p-4">
               No stock alerts
            </p>
         )}
         {!loading && !_lowStockProducts && (
            <div className="w-full h-full border flex items-center justify-center rounded-lg p-8">
               <div className="flex flex-col gap-4">
                  <p className="text-sm text-muted-foreground">
                     Error loading stock alerts
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
