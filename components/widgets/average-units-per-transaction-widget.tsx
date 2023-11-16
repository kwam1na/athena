'use client';

import { Button } from '@/components/ui/button';
import { MetricCard } from '@/components/ui/metric-card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatter } from '@/lib/utils';
import { useStoreCurrency } from '@/providers/currency-provider';
import { Package, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { apiGetMetric } from '@/lib/api/metrics';
import { set } from 'date-fns';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';
import { motion } from 'framer-motion';
import { widgetVariants } from '@/lib/constants';

interface AverageUnitsPerTransactionWidgetProps {
   averageUnitsPerTransaction?: number;
}

export const AverageUnitsPerTransactionWidget: React.FC<
   AverageUnitsPerTransactionWidgetProps
> = ({ averageUnitsPerTransaction }) => {
   const [_averageUnitsPerTransaction, setAverageUnitsPerTransaction] =
      useState<number | undefined>(averageUnitsPerTransaction);
   const [loading, setLoading] = useState(false);
   const params = useParams();
   const baseStoreURL = useGetBaseStoreUrl();

   const fetchData = async () => {
      setLoading(true);
      try {
         const res = await apiGetMetric(
            params.storeId,
            'average_units_per_transaction',
         );
         const { data } = res;
         setAverageUnitsPerTransaction(data.average_units_per_transaction);
      } catch (error) {
         setAverageUnitsPerTransaction(undefined);
         console.error(error);
      } finally {
         setLoading(false);
      }
   };

   return (
      <>
         {!loading && typeof _averageUnitsPerTransaction === 'number' && (
            <Link href={`${baseStoreURL}/transactions`}>
               <MetricCard
                  title={'Avg units per transaction'}
                  value={
                     isNaN(_averageUnitsPerTransaction)
                        ? '0'
                        : _averageUnitsPerTransaction.toFixed().toString()
                  }
                  icon={<Package className="h-4 w-4 text-muted-foreground" />}
               />
            </Link>
         )}
         {!loading && typeof _averageUnitsPerTransaction !== 'number' && (
            <div className="w-full h-full border flex items-center justify-center rounded-lg p-8">
               <div className="flex flex-col gap-4">
                  <p className="text-sm text-muted-foreground">
                     Error loading average units per transaction
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
