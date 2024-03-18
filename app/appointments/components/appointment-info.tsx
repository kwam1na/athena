import { Badge } from '@/components/ui/badge';
import { Appointment, AppointmentStatus } from '@/lib/types';
import { format, isToday } from 'date-fns';

export const AppointmentStatusBadge = ({
   status,
}: {
   status: AppointmentStatus;
}) => {
   if (status == 'pending') return null;

   const className =
      status == 'in-progress'
         ? 'bg-green-500'
         : status == 'canceled'
         ? 'border border-red-400 bg-background text-red-400'
         : '';

   const text =
      status == 'in-progress'
         ? 'In progress'
         : status == 'ended'
         ? 'Ended'
         : status == 'canceled'
         ? 'Canceled'
         : '';

   if (status == 'in-progress' || status == 'canceled') {
      return <Badge className={className}>{text}</Badge>;
   }

   return <Badge>{text}</Badge>;
};

export const AppointmentActionTime = ({
   appointment,
}: {
   appointment: Appointment;
}) => {
   const { status, check_in_time, canceled_at_time, end_time } = appointment;

   if (status == 'pending') return null;

   const date =
      status == 'in-progress'
         ? check_in_time
         : status == 'canceled'
         ? canceled_at_time
         : end_time;

   if (!date) return null;

   const action =
      status == 'in-progress'
         ? 'Checked in:'
         : status == 'canceled'
         ? 'Canceled at:'
         : status == 'ended'
         ? 'Ended at:'
         : '';

   const formatString = isToday(date)
      ? 'h:mm aaa'
      : "MMMM dd, yy 'at' h:mm aaa";
   return (
      <p className="text-sm text-muted-foreground">{`${action} ${format(
         date,
         formatString,
      )}`}</p>
   );
};
