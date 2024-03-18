import { format } from 'date-fns';

import prismadb from '@/lib/prismadb';
import { formatter } from '@/lib/utils';

import { ServiceColumn } from '../components/columns';
import { ServicesClient } from '../components/client';
import { getStore } from '@/lib/repositories/storesRepository';
import { fetchServices } from '@/lib/repositories/servicesRepository';

const ServicesPage = async ({ params }: { params: { storeId: string } }) => {
   const storeId = parseInt(params.storeId);
   const store = await getStore(storeId);
   const fmt = formatter(store?.currency || 'usd');

   const services = await fetchServices({ store_id: storeId });

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
      <div className="flex-col">
         <div className="flex-1 space-y-6 space-y-4 p-8 pt-6">
            <ServicesClient data={formattedServices} />
         </div>
      </div>
   );
};

export default ServicesPage;
