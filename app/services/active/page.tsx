import { fetchServices } from '@/lib/repositories/servicesRepository';
import { ServicesClient } from '../components/client';
import { Service } from '@/lib/types';

export default async function ActiveServices() {
   const services = await fetchServices({ store_id: 1, is_active: true });

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
      <div className="flex-col">
         <div className="flex-1 space-y-6 space-y-4 p-8 pt-6">
            <ServicesClient data={formattedServices} />
         </div>
      </div>
   );
}
