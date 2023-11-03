'use client';

import { Button } from '@/components/ui/button';
import { MetricCard } from '@/components/ui/metric-card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGetMetric } from '@/lib/api/metrics';
import { PackageMinus, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

interface TotalUnitsSoldWidgetProps {
   totalUnitsSold?: number;
   percentageChange?: number;
}

export const TotalUnitsSoldWidget: React.FC<TotalUnitsSoldWidgetProps> = ({
   totalUnitsSold,
   percentageChange,
}) => {
   const [_totalUnitsSold, setTotalUnitsSold] = useState<number | undefined>(
      totalUnitsSold,
   );
   const [loading, setLoading] = useState(false);
   const params = useParams();

   const fetchData = async () => {
      setLoading(true);
      try {
         const res = await apiGetMetric(params.storeId, 'total_units_sold');
         const { data } = res;
         setTotalUnitsSold(data.total_units_sold);
      } catch (error) {
         setTotalUnitsSold(undefined);
         console.error(error);
      } finally {
         setLoading(false);
      }
   };

   return (
      <>
         {!loading && typeof _totalUnitsSold === 'number' && (
            <Link href={`/${params.storeId}/transactions`}>
               <MetricCard
                  title={'Total units sold'}
                  value={_totalUnitsSold.toString()}
                  icon={
                     <PackageMinus className="h-4 w-4 text-muted-foreground" />
                  }
                  percentageChange={percentageChange}
               />
            </Link>
         )}
         {!loading && typeof _totalUnitsSold !== 'number' && (
            <div className="w-full h-full border flex items-center justify-center rounded-lg p-8">
               <div className="flex flex-col gap-4">
                  <p className="text-sm text-muted-foreground">
                     Error loading total units sold
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
