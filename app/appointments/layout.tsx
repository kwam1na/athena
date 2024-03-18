import { Sidebar } from '@/components/sidebar';
import { AppointmentsHeader } from './components/appointments-heaader';
import { fetchAppointments } from '@/lib/repositories/appointmentsRepository';

export default async function AppointmentsLayout({
   children,
}: {
   children: React.ReactNode;
}) {
   const appointments = await fetchAppointments({ store_id: 1 });
   const upcomingAppointmentsCount = appointments.filter(
      (appointment) => appointment.status == 'pending',
   ).length;
   const inProgressAppointments = appointments.filter(
      (appointment) => appointment.status == 'in-progress',
   ).length;
   const pastAppointments = appointments.filter((appointment) =>
      ['ended', 'canceled'].includes(appointment.status),
   ).length;

   return (
      <section className="w-full h-screen">
         <AppointmentsHeader />
         <Sidebar
            sideNavClassName="bg-card"
            routes={[
               {
                  href: `/appointments/upcoming`,
                  aliases: ['/appointments'],
                  label: 'Upcoming',
                  secondaryLabel: `${upcomingAppointmentsCount}`,
               },
               {
                  href: `/appointments/in-progress`,
                  label: 'In progress',
                  secondaryLabel: `${inProgressAppointments}`,
               },
               {
                  href: `/appointments/ended`,
                  label: 'Ended',
                  secondaryLabel: `${pastAppointments}`,
               },
            ]}
         >
            {children}
         </Sidebar>
      </section>
   );
}
