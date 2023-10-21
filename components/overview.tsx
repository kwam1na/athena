'use client';

import { formatter } from '@/lib/utils';
import { useStoreCurrency } from '@/providers/currency-provider';
import { useTheme } from 'next-themes';
import {
   XAxis,
   YAxis,
   Tooltip,
   ResponsiveContainer,
   Area,
   AreaChart,
} from 'recharts';

interface OverviewProps {
   data: any[];
}

export const Overview: React.FC<OverviewProps> = ({ data }) => {
   const { theme } = useTheme();
   const { storeCurrency } = useStoreCurrency();
   const fmt = formatter(storeCurrency);

   const grossColor = '#588157';
   const netColor = '#00a6fb';
   // const grossColor = theme === 'light' ? '#3498db' : '#5DADE2';
   // const netColor = theme === 'light' ? '#e74c3c' : '#EC7063';

   const CustomTooltip = ({
      active,
      payload,
      label,
   }: {
      active?: any;
      payload?: any;
      label?: any;
   }) => {
      if (active && payload && payload.length) {
         return (
            <div className="bg-card p-4 rounded-md">
               <p className="text-sm text-muted-foreground">{`Month: ${label}`}</p>
               {payload.map((item: any, index: number) => (
                  <p key={index} className="text-sm text-muted-foreground">
                     {`${item.name}: ${fmt.format(item.value)}`}
                  </p>
               ))}
            </div>
         );
      }
      return null;
   };
   return (
      <ResponsiveContainer width="100%" height={580}>
         <AreaChart
            width={500}
            height={400}
            data={data}
            margin={{
               top: 10,
               right: 30,
               left: 0,
               bottom: 0,
            }}
         >
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip content={<CustomTooltip />} />
            <defs>
               <linearGradient id="colorGross" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={grossColor} stopOpacity={0.8} />
                  <stop offset="95%" stopColor={grossColor} stopOpacity={0} />
               </linearGradient>
               <linearGradient id="colorNet" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={netColor} stopOpacity={0.8} />
                  <stop offset="95%" stopColor={netColor} stopOpacity={0} />
               </linearGradient>
            </defs>
            <Area
               type="monotone"
               dataKey="grossRevenue"
               stroke="none"
               fill="url(#colorGross)"
            />
            <Area
               type="monotone"
               dataKey="netRevenue"
               stroke="none"
               fill="url(#colorNet)"
            />
         </AreaChart>
      </ResponsiveContainer>
   );
};
