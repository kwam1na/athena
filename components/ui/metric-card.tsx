import { TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './card';

interface MetricCardProps {
   title: string;
   value: string;
   percentageChange?: number;
   icon?: React.ReactNode;
}

export const MetricCard: React.FC<MetricCardProps> = ({
   title,
   value,
   percentageChange,
   icon,
}) => (
   <Card className="space-y-4 bg-background hover:bg-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
         <CardTitle className="text-sm font-medium">{title}</CardTitle>
         {icon}
      </CardHeader>
      <CardContent className="space-y-4">
         <div className="text-2xl font-bold">{value}</div>
         {typeof percentageChange === 'number' && (
            <div className="md:flex space-x-1 flex-col lg:flex-row">
               <div className="flex items-center space-x-2">
                  {percentageChange > 0 && (
                     <TrendingUp className="ml-2 h-4 w-4 text-green-500" />
                  )}
                  {percentageChange < 0 && (
                     <TrendingDown className="ml-2 h-4 w-4 text-red-500" />
                  )}
                  <p
                     className={`text-md text-muted-foreground ${
                        percentageChange > 0
                           ? 'text-green-500'
                           : percentageChange < 0
                           ? 'text-red-500'
                           : ''
                     }`}
                  >
                     {percentageChange === 0
                        ? ''
                        : `${percentageChange.toFixed(2)}%`}
                  </p>
               </div>
               <p className="flex items-center text-sm text-muted-foreground">
                  {percentageChange !== 0 && 'compared to last week'}
               </p>
            </div>
         )}
      </CardContent>
   </Card>
);
