import { AppointmentIntervalBadge } from '@/components/appointment-interval-badge';
import { InfoLine } from '@/components/info-line';
import { Service } from '@/lib/types';
import { formatter } from '@/lib/utils';
import { Banknote, Clock } from 'lucide-react';
import { ServiceSheet } from './service-sheet';

export const ServiceCell = ({ service }: { service: Service }) => {
   const fmt = formatter(service.currency);
   return (
      <ServiceSheet service={service}>
         <div className="w-full space-y-4 border bg-background shadow-sm rounded-md p-6 cursor-pointer">
            <div className="flex justify-between">
               <InfoLine text={service.name} isBold />
               <AppointmentIntervalBadge interval={service.interval_type} />
            </div>

            <InfoLine
               text={`${fmt.format(service.price)}/session`}
               icon={<Banknote className="w-4 h-4 text-muted-foreground" />}
               isMuted
            />

            <InfoLine
               text={`${service.start_time} - ${service.end_time}`}
               icon={<Clock className="w-4 h-4 text-muted-foreground" />}
               isMuted
            />
         </div>
      </ServiceSheet>
   );
};
