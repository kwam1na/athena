'use client';

import { GraphData } from '@/actions/get-graph-revenue';
import { Overview } from '@/components/overview';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard } from '@/components/ui/metric-card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatter } from '@/lib/utils';
import { useStoreCurrency } from '@/providers/currency-provider';
import { DollarSign, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

interface GraphRevenueWidgetProps {
   graphData?: GraphData[];
}

export const GraphRevenueWidget: React.FC<GraphRevenueWidgetProps> = ({
   graphData,
}) => {
   const [_graphData, setgraphData] = useState<GraphData[] | undefined>(
      graphData,
   );
   const [loading, setLoading] = useState(false);
   const { storeCurrency } = useStoreCurrency();
   const fmt = formatter(storeCurrency);
   const params = useParams();

   return (
      <>
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
      </>
   );
};
