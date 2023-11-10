'use client';

import { Button } from '@/components/ui/button';
import { MetricCard } from '@/components/ui/metric-card';
import { Skeleton } from '@/components/ui/skeleton';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';
import { apiGetMetric } from '@/lib/api/metrics';
import { formatter } from '@/lib/utils';
import { useStoreCurrency } from '@/providers/currency-provider';
import { set } from 'date-fns';
import { DollarSign, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { widgetVariants } from '@/lib/constants';
interface NetRevenueWidgetProps {
   netRevenue?: number;
   percentageChange?: number;
}

export const NetRevenueWidget: React.FC<NetRevenueWidgetProps> = ({
   netRevenue,
   percentageChange,
}) => {
   const [_netRevenue, setNetRevenue] = useState<number | undefined>(
      netRevenue,
   );
   const [loading, setLoading] = useState(false);
   const { storeCurrency, loading: isCurrencyLoading } = useStoreCurrency();
   const fmt = formatter(storeCurrency);
   const params = useParams();
   const baseStoreURL = useGetBaseStoreUrl();

   const fetchData = async () => {
      setLoading(true);
      try {
         const res = await apiGetMetric(params.storeId, 'net_revenue');
         const { data } = res;
         setNetRevenue(data.net_revenue);
      } catch (error) {
         setNetRevenue(undefined);
         console.error(error);
      } finally {
         setLoading(false);
      }
   };

   return (
      <motion.div
         variants={widgetVariants}
         initial="hidden"
         animate="visible"
         className="space-y-8"
      >
         {typeof _netRevenue === 'number' && !loading && !isCurrencyLoading && (
            <Link href={`${baseStoreURL}/transactions`}>
               <MetricCard
                  title={'Net revenue'}
                  value={fmt.format(_netRevenue)}
                  icon={
                     <DollarSign className="h-4 w-4 text-muted-foreground" />
                  }
                  percentageChange={percentageChange}
               />
            </Link>
         )}
         {typeof _netRevenue !== 'number' && !loading && (
            <div className="w-full h-full border flex items-center justify-center rounded-lg">
               <div className="flex flex-col gap-4">
                  <p className="text-sm text-muted-foreground">
                     Error loading net revenue
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
      </motion.div>
   );
};
