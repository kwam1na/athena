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
         <div className="w-full flex items-center justify-between border bg-background shadow-sm rounded-md p-4 cursor-pointer">
            <div className="flex items-center gap-4">
               <InfoLine text={service.name} isBold />

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
            <AppointmentIntervalBadge interval={service.interval_type} />
         </div>
      </ServiceSheet>
   );
};
