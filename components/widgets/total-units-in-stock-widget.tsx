'use client';

import { Button } from '@/components/ui/button';
import { MetricCard } from '@/components/ui/metric-card';
import { Skeleton } from '@/components/ui/skeleton';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';
import { apiGetMetric } from '@/lib/api/metrics';
import { formatter } from '@/lib/utils';
import { useStoreCurrency } from '@/providers/currency-provider';
import { set } from 'date-fns';
import { PackageCheck, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { widgetVariants } from '@/lib/constants';
interface TotalStockWidgetProps {
   stockCount?: number;
}

export const TotalStockWidget: React.FC<TotalStockWidgetProps> = ({
   stockCount,
}) => {
   const [_totalStockCount, setTotalStockCount] = useState<number | undefined>(
      stockCount,
   );
   const [loading, setLoading] = useState(false);
   const params = useParams();
   const baseStoreURL = useGetBaseStoreUrl();

   const fetchData = async () => {
      setLoading(true);
      try {
         const res = await apiGetMetric(params.storeId, 'total_stock_count');
         const { data } = res;
         setTotalStockCount(data.total_stock_count);
      } catch (error) {
         setTotalStockCount(undefined);
         console.error(error);
      } finally {
         setLoading(false);
      }
   };

   return (
      <>
         {!loading && typeof _totalStockCount === 'number' && (
            <Link href={`${baseStoreURL}/inventory/products`}>
               <MetricCard
                  title={'Products in stock'}
                  value={_totalStockCount.toString()}
                  icon={
                     <PackageCheck className="h-4 w-4 text-muted-foreground" />
                  }
               />
            </Link>
         )}
         {!loading && typeof _totalStockCount !== 'number' && (
            <div className="w-full h-full border flex items-center justify-center rounded-lg p-8">
               <div className="flex flex-col gap-4">
                  <p className="text-sm text-muted-foreground">
                     Error loading products in stock
                  </p>
                  <Button variant={'ghost'} onClick={fetchData}>
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
      </>
   );
};
