'use client';

import { Button } from '@/components/ui/button';
import { MetricCard } from '@/components/ui/metric-card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGetMetric } from '@/lib/api/metrics';
import { formatter } from '@/lib/utils';
import { useStoreCurrency } from '@/providers/currency-provider';
import { DollarSign, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

interface GrossRevenueWidgetProps {
   grossRevenue?: number;
   percentageChange?: number;
}

export const GrossRevenueWidget: React.FC<GrossRevenueWidgetProps> = ({
   grossRevenue,
   percentageChange,
}) => {
   const [_grossRevenue, setGrossRevenue] = useState<number | undefined>(
      grossRevenue,
   );
   const [loading, setLoading] = useState(false);
   const { storeCurrency, loading: isCurrencyLoading } = useStoreCurrency();
   const fmt = formatter(storeCurrency);
   const params = useParams();

   const fetchData = async () => {
      setLoading(true);
      try {
         const res = await apiGetMetric(params.storeId, 'gross_revenue');
         const { data } = res;
         setGrossRevenue(data.gross_revenue);
      } catch (error) {
         setGrossRevenue(undefined);
         console.error(error);
      } finally {
         setLoading(false);
      }
   };

   return (
      <>
         {typeof _grossRevenue === 'number' &&
            !loading &&
            !isCurrencyLoading && (
               <Link href={`/${params.storeId}/transactions`}>
                  <MetricCard
                     title={'Gross revenue'}
                     value={fmt.format(_grossRevenue)}
                     icon={
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                     }
                     percentageChange={percentageChange}
                  />
               </Link>
            )}
         {typeof _grossRevenue !== 'number' && !loading && (
            <div className="w-full h-full border flex items-center justify-center rounded-lg">
               <div className="flex flex-col gap-4">
                  <p className="text-sm text-muted-foreground">
                     Error loading gross revenue
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
