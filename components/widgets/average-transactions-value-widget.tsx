'use client';

import { Button } from '@/components/ui/button';
import { MetricCard } from '@/components/ui/metric-card';
import { Skeleton } from '@/components/ui/skeleton';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';
import { apiGetMetric } from '@/lib/api/metrics';
import { formatter } from '@/lib/utils';
import { useStoreCurrency } from '@/providers/currency-provider';
import { DollarSign, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

interface AverageTransactionValueWidgetProps {
   averageTransactionValue?: number;
}

export const AverageTransactionValueWidget: React.FC<
   AverageTransactionValueWidgetProps
> = ({ averageTransactionValue }) => {
   const [_averageTransactionValue, setAverageTransactionValue] = useState<
      number | undefined
   >(averageTransactionValue);
   const [loading, setLoading] = useState(false);
   const params = useParams();
   const baseStoreURL = useGetBaseStoreUrl();
   const { storeCurrency, loading: isCurrencyLoading } = useStoreCurrency();
   const fmt = formatter(storeCurrency);

   const fetchData = async () => {
      setLoading(true);
      try {
         const res = await apiGetMetric(
            params.storeId,
            'average_transaction_value',
         );
         const { data } = res;
         setAverageTransactionValue(data.average_transaction_value);
      } catch (error) {
         setAverageTransactionValue(undefined);
         console.error(error);
      } finally {
         setLoading(false);
      }
   };

   return (
      <>
         {!loading &&
            typeof _averageTransactionValue === 'number' &&
            !isCurrencyLoading && (
               <Link href={`${baseStoreURL}/transactions`}>
                  <MetricCard
                     title={'Avg transaction value (gross)'}
                     value={fmt.format(
                        isNaN(_averageTransactionValue)
                           ? 0
                           : _averageTransactionValue,
                     )}
                     icon={
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                     }
                  />
               </Link>
            )}
         {!loading && typeof _averageTransactionValue !== 'number' && (
            <div className="w-full h-full border flex items-center justify-center rounded-lg p-8">
               <div className="flex flex-col gap-4">
                  <p className="text-sm text-muted-foreground">
                     Error loading average transaction value
                  </p>
                  <Button variant={'ghost'} onClick={fetchData}>
                     <RotateCcw className="mr-2 h-4 w-4 text-muted-foreground" />
                     <p className="text-muted-foreground">Reload</p>
                  </Button>
               </div>
            </div>
         )}
         {(loading || isCurrencyLoading) && (
            <div className="flex flex-col gap-4 w-full h-full justify-center border rounded-lg p-8">
               <Skeleton className="w-[80%] h-8" />
               <Skeleton className="w-[60%] h-8" />
            </div>
         )}
      </>
   );
};
