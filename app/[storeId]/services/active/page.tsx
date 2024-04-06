import { fetchServices } from '@/lib/repositories/servicesRepository';
import { ServicesClient } from '../components/client';
import { Service } from '@/lib/types';
import { getStore } from '@/lib/repositories/storesRepository';
import { EmptyState } from '@/components/states/empty/empty-state';
import { Scissors } from 'lucide-react';
import { formatServiceForClient } from '@/lib/mappers/services';

export default async function ActiveServices() {
   const store = await getStore(1);
   const services = await fetchServices({ store_id: 1, is_active: true });

   const formattedServices: Service[] = services.map((service) =>
      formatServiceForClient(service, store?.currency),
   );

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-6 space-y-4 p-8 pt-6">
            {formattedServices.length > 0 && (
               <ServicesClient data={formattedServices} />
            )}
            {formattedServices.length == 0 && (
               <EmptyState
                  icon={
                     <Scissors
                        size={'40px'}
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
