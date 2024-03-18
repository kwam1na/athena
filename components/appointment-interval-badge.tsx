import { Clock } from 'lucide-react';
import { Badge } from './ui/badge';

export const AppointmentIntervalBadge = ({
   interval,
}: {
   interval?: string;
}) => {
   if (!interval) return null;

   return (
      <Badge className="flex gap-2">
         <Clock className="w-4 h-4" />
         {interval == 'halfHour' ? '30 minutes' : '1 hour'}
      </Badge>
   );
};
