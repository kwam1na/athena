import { Sidebar } from '@/components/sidebar';
import { fetchServices } from '@/lib/repositories/servicesRepository';
import { ServicesHeader } from './components/services-heaader';

export default async function ServicesLayout({
   children,
}: {
   children: React.ReactNode;
}) {
   const services = await fetchServices({ store_id: 1 });
   const UpcomingAppointmentsCount = services.filter(
      (service) => service.is_active && !service.is_archived,
   ).length;
   const archivedServicesCount = services.filter(
      (service) => service.is_archived,
   ).length;

   return (
      <section className="w-full h-screen">
         <ServicesHeader />
         <Sidebar
            hideWhenOnRoutes={['/services/new', '/edit']}
            sideNavClassName="bg-card"
            routes={[
               {
                  href: `/services/active`,
                  aliases: ['/services'],
                  label: 'Active',
                  secondaryLabel: `${UpcomingAppointmentsCount}`,
               },
               {
                  href: `/services/archived`,
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
