import { getService } from '@/lib/repositories/servicesRepository';
import { ServiceForm } from '../components/service-form';
import { formatServiceForClient } from '@/lib/mappers/services';
import { getStore } from '@/lib/repositories/storesRepository';

export default async function ServicePage({
   params,
}: {
   params: { storeId: string; serviceId: string };
}) {
   const { storeId, serviceId } = params;
   const store = await getStore(parseInt(storeId));
   const service = await getService(serviceId);

   return serviceId == 'new' ? (
      <ServiceForm />
   ) : service ? (
      <ServiceForm service={formatServiceForClient(service, store?.currency)} />
   ) : (
      <span>Yeah, nahh</span>
   );
}
