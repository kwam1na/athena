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
      <section className="w-full">
         <AppointmentsHeader />
         <Sidebar
            sideNavClassName="ml-8 w-[280px] rounded-lg flex h-screen items-center backdrop-blur-md bg-opacity-30 justify-between fixed top-32 left-16 z-10"
            routes={[
               {
                  href: `/1/appointments/upcoming`,
                  aliases: ['/1/appointments'],
                  label: 'Upcoming',
                  secondaryLabel: `${upcomingAppointmentsCount}`,
               },
               {
                  href: `/1/appointments/in-progress`,
                  label: 'In progress',
                  secondaryLabel: `${inProgressAppointments}`,
               },
               {
                  href: `/1/appointments/ended`,
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
