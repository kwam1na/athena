import { getStore } from '@/lib/repositories/storesRepository';
import { SettingsForm } from '../components/settings-form';
import { BusinessHours, Store } from '@/lib/types';

export default async function StoreSettingsPage() {
   const store = await getStore(1);

   const hours = store?.store_hours as Record<string, any>[];
   const store_hours: BusinessHours = hours.map((hour) => ({
      day: hour?.day,
      is_closed: hour?.is_closed,
      open_time: hour?.open_time,
      close_time: hour?.close_time,
   }));

   const location = store?.store_location as Record<string, string>;
   const transformed: Store = {
      name: store?.name,
      currency: store?.currency,
      store_hours,
      store_location: {
         street_address: location?.street_address,
         city: location?.city,
         country: location?.country,
      },
      store_phone_number: store?.store_phone_number,
   };

   return (
      <div className="flex-col h-screen bg-background">
         <div className="flex-1 space-y-6 space-y-4 p-8 pt-6">
            <SettingsForm store={transformed} />
         </div>
      </div>
   );
}
