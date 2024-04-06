import { Sidebar } from '@/components/sidebar';
import { fetchServices } from '@/lib/repositories/servicesRepository';
import { ServicesHeader } from './components/services-heaader';
import { CurrencyProvider } from '@/providers/currency-provider';

export default async function ServicesLayout({
   params,
   children,
}: {
   params: { storeId: string };
   children: React.ReactNode;
}) {
   const { storeId } = params;
   const services = await fetchServices({ store_id: parseInt(storeId) });
   const UpcomingAppointmentsCount = services.filter(
      (service) => service.is_active && !service.is_archived,
   ).length;
   const archivedServicesCount = services.filter(
      (service) => service.is_archived,
   ).length;

   return (
      <section className="w-full">
         <ServicesHeader />
         <Sidebar
            hideWhenOnRoutes={['/services/new']}
            sideNavClassName="ml-8 w-[280px] rounded-lg flex h-screen items-center backdrop-blur-md bg-opacity-30 justify-between fixed top-32 left-16 z-10"
            routes={[
               {
                  href: `/${storeId}/services/active`,
                  aliases: [`/${storeId}/services`],
                  label: 'Active',
                  secondaryLabel: `${UpcomingAppointmentsCount}`,
               },
               {
                  href: `/${storeId}/services/archived`,
                  label: 'Archived',
                  secondaryLabel: `${archivedServicesCount}`,
               },
            ]}
         >
            {children}
         </Sidebar>
      </section>
   );
}
