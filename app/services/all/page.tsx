import { fetchServices } from '@/lib/repositories/servicesRepository';
import { getStore } from '@/lib/repositories/storesRepository';
import { formatter } from '@/lib/utils';
import { ServiceColumn } from '../components/columns';
import { ServicesClient } from '../components/client';

export default async function AllServices() {
   const store = await getStore(1);
   const fmt = formatter(store?.currency || 'usd');

   const services = await fetchServices({ store_id: 1 });

   const formattedServices: ServiceColumn[] = services.map((service) => ({
      id: service.id,
      name: service.name,
      price: fmt.format(service.price),
      startTime: service.start_time,
      endTime: service.end_time,
      intervalType:
         service.interval_type === 'halfHour' ? '30-minute' : 'Hourly',
   }));

   return (
      <div className="flex-col h-screen">
         <div className="flex-1 space-y-6 space-y-4 p-8 pt-6">
            <ServicesClient data={formattedServices} />
         </div>
      </div>
   );
}
