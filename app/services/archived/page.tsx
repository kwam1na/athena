import { fetchServices } from '@/lib/repositories/servicesRepository';
import { ServicesClient } from '../components/client';
import { EmptyState } from '@/components/states/empty/empty-state';
import { Archive } from 'lucide-react';
import { Service } from '@/lib/types';

export default async function ArchivedServices() {
   const services = await fetchServices({ store_id: 1, is_archived: true });

   const formattedServices: Service[] = services.map((service) => ({
      id: service.id,
      is_archived: service.is_archived,
      currency: service.currency,
      name: service.name,
      price: service.price,
      start_time: service.start_time,
      end_time: service.end_time,
      interval_type: service.interval_type,
      appointments: [],
   }));

   return (
      <div className="flex-col h-screen">
         <div className="flex-1 space-y-6 space-y-4 p-8 pt-6">
            {formattedServices.length > 0 && (
               <ServicesClient data={formattedServices} />
            )}
            {formattedServices.length == 0 && (
               <EmptyState
                  icon={
                     <Archive
                        size={'112px'}
                        color="#5C5C5C"
                        strokeWidth={'1px'}
                     />
                  }
                  text="No archived services"
               />
            )}
         </div>
      </div>
   );
}
