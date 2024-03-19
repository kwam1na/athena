import { AppointmentsClient } from '../components/client';
import { fetchAppointments } from '@/lib/repositories/appointmentsRepository';
import { Appointment, AppointmentStatus } from '@/lib/types';
import { EmptyState } from '@/components/states/empty/empty-state';
import { CalendarX2 } from 'lucide-react';

export default async function UpcomingAppointments() {
   const appointments = await fetchAppointments({
      store_id: 1,
      status: ['pending'],
      includeForeignKeys: ['customer'],
   });

   const formatted: Appointment[] = appointments.map((appointment) => ({
      id: appointment.id,
      canceled_at_time: appointment.canceled_at_time,
      check_in_time: appointment.check_in_time,
      end_time: appointment.end_time,
      time_slot: appointment.time_slot,
      date: appointment.date,
      service_id: appointment.service_id,
      status: appointment.status as AppointmentStatus,
      service: {
         id: appointment.service.id,
         interval_type: appointment.service.interval_type,
         name: appointment.service.name,
         price: appointment.service.price,
         currency: appointment.service.currency,
         start_time: appointment.service.start_time,
         end_time: appointment.service.end_time,
         appointments: [],
      },
      customer: {
         id: appointment.customer?.id,
         email: appointment.customer?.email,
         first_name: appointment.customer?.first_name,
         last_name: appointment.customer?.last_name,
         phone_number: appointment.customer?.phone_number,
      },
   }));

   return (
      <div className="flex-col h-screen">
         <div className="flex-1 space-y-6 space-y-4 p-8 pt-6">
            {formatted.length > 0 && <AppointmentsClient data={formatted} />}
            {formatted.length == 0 && (
               <EmptyState
                  icon={
                     <CalendarX2
                        size={'112px'}
                        color="#5C5C5C"
                        strokeWidth={'1px'}
                     />
                  }
                  text="No upcoming appointments"
               />
            )}
         </div>
      </div>
   );
}
