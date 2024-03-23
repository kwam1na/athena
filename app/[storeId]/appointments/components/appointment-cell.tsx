import { Appointment } from '@/lib/types';
import { format, isToday, isTomorrow } from 'date-fns';
import { Calendar, Scissors, User } from 'lucide-react';
import { AppointmentSheet } from './appointment-sheet';
import { AppointmentStatusBadge } from './appointment-info';
import { InfoLine } from '@/components/info-line';
import { AppointmentIntervalBadge } from '@/components/appointment-interval-badge';

export const AppointmentCell = ({
   appointment,
}: {
   appointment: Appointment;
}) => {
   return (
      <AppointmentSheet appointment={appointment}>
         <div className="w-full flex items-center justify-between border bg-background shadow-sm rounded-md p-4 cursor-pointer">
            <div className="flex items-center gap-4 w-[70%]">
               <InfoLine
                  icon={<User className="w-4 h-4 text-muted-foreground" />}
                  text={`${appointment.customer?.first_name} ${appointment.customer?.last_name}`}
                  isBold
                  className="w-[40%]"
               />

               <InfoLine
                  icon={<Scissors className="text-muted-foreground w-4 h-4" />}
                  text={appointment.service?.name}
                  className="w-[30%]"
               />

               <InfoLine
                  icon={<Calendar className="text-muted-foreground w-4 h-4" />}
                  text={
                     isToday(appointment.date)
                        ? `Today at ${appointment.time_slot}`
                        : isTomorrow(appointment.date)
                        ? `Tomorrow at ${appointment.time_slot}`
                        : format(
                             appointment.date,
                             "MMMM dd, yyyy 'at' h:mm aaa",
                          )
                  }
                  isMuted
               />
            </div>

            <div className="flex gap-2">
               <AppointmentIntervalBadge
                  interval={appointment.service?.interval_type}
               />

               <AppointmentStatusBadge status={appointment.status} />
            </div>
         </div>
      </AppointmentSheet>
   );
};
