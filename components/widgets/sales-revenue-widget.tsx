'use client';

import { GraphData } from '@/actions/get-sales-revenue';
import { Overview } from '@/components/overview';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard } from '@/components/ui/metric-card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGetMetric } from '@/lib/api/metrics';
import { formatter } from '@/lib/utils';
import { useStoreCurrency } from '@/providers/currency-provider';
import { DollarSign, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { widgetVariants } from '@/lib/constants';
interface SalesRevenueGraphWidgetProps {
   graphData?: GraphData[];
}

export const SalesRevenueGraphWidget: React.FC<
   SalesRevenueGraphWidgetProps
> = ({ graphData }) => {
   const [_graphData, setGraphData] = useState<GraphData[] | undefined>(
      graphData,
   );
   const [loading, setLoading] = useState(false);
   const params = useParams();

   const fetchData = async () => {
      setLoading(true);
      try {
         const res = await apiGetMetric(params.storeId, 'sales_revenue');
         const { data } = res;
         setGraphData(data.sales_revenue);
      } catch (error) {
         setGraphData(undefined);
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
         {!loading && _graphData && _graphData.length > 1 && (
            <Card className="col-span-4 bg-background w-full">
               <CardHeader>
                  <CardTitle>Sales revenue</CardTitle>
               </CardHeader>
               <CardContent className="pl-2 h-full p-8">
                  <Overview data={_graphData} />
               </CardContent>
            </Card>
         )}
         {!loading && !_graphData && (
            <div className="w-full h-full border flex items-center justify-center rounded-lg p-8">
               <div className="flex flex-col gap-4">
                  <p className="text-sm text-muted-foreground">
                     Error loading sales revenue
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
      </motion.div>
   );
};
