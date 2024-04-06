import { AppointmentIntervalBadge } from '@/components/appointment-interval-badge';
import { InfoLine } from '@/components/info-line';
import { Service } from '@/lib/types';
import { formatter } from '@/lib/utils';
import { Banknote, Clock } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

export const ServiceCell = ({ service }: { service: Service }) => {
   const fmt = formatter(service.currency);
   const params = useParams();
   return (
      <Link href={`/${params.storeId}/services/${service.id}`}>
         <div className="w-full flex items-center justify-between border bg-background shadow-sm rounded-md p-6 cursor-pointer">
            <div className="flex w-full flex-col gap-3">
               <div className="w-full flex justify-between">
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
         </div>
      </Link>
   );
};
