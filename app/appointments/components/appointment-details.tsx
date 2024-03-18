import { Appointment } from '@/lib/types';
import { AppointmentStatusBadge } from './appointment-info';
import {
   Ban,
   Banknote,
   Calendar,
   Check,
   CheckCircle2,
   Clock,
   Scissors,
   XCircle,
} from 'lucide-react';
import { apiUpdateAppointment } from '@/lib/api/appointments';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatter } from '@/lib/utils';
import { format, isToday } from 'date-fns';
import { InfoLine } from '@/components/info-line';
import { useRouter } from 'next/navigation';
import { LoadingButton } from '@/components/ui/loading-button';

const AppointmentDetailsBody = ({
   appointment,
}: {
   appointment: Appointment;
}) => {
   const fmt = formatter(appointment.service?.currency || 'usd');
   return (
      <div className="flex flex-col gap-4">
         <InfoLine
            icon={<Scissors className="w-4 h-4 text-muted-foreground" />}
            text={appointment.service?.name}
         />

         <InfoLine
            icon={<Banknote className="w-4 h-4 text-muted-foreground" />}
            text={`${fmt.format(appointment.service?.price || 0)}/session`}
         />

         <InfoLine
            icon={<Calendar className="w-4 h-4 text-muted-foreground" />}
            text={
               isToday(appointment.date)
                  ? `Today at ${appointment.time_slot}`
                  : format(appointment.date, "MMMM dd, yyyy 'at' h:mm aaa")
            }
         />

         <InfoLine
            icon={<Clock className="w-4 h-4 text-muted-foreground" />}
            text={
               appointment.service?.interval_type == 'halfHour'
                  ? '30 minutes'
                  : '1 hour'
            }
         />
      </div>
   );
};

export const AppointmentDetails = ({
   appointment,
   setOpen,
}: {
   appointment: Appointment;
   setOpen: (open: boolean) => void;
}) => {
   const router = useRouter();

   const updateAppointment = async (action: 'check-in' | 'end' | 'cancel') => {
      await apiUpdateAppointment(appointment.id, '1', {
         action,
      });
   };

   const checkInAppointment = async () => {
      await updateAppointment('check-in');
   };

   const endAppointment = async () => {
      await updateAppointment('end');
   };

   const cancelAppointment = async () => {
      await updateAppointment('cancel');
   };

   const checkInAppointmentMutation = useMutation({
      mutationFn: checkInAppointment,
      onSuccess: () => {
         setOpen(false);
         toast('Customer checked in', {
            icon: <CheckCircle2 className="h-4 w-4" />,
         });
         router.refresh();
      },
      onError: () => {
         toast('Something went wrong', {
            icon: <Ban className="h-4 w-4" />,
         });
      },
   });

   const cancelAppointmentMutation = useMutation({
      mutationFn: cancelAppointment,
      onSuccess: () => {
         setOpen(false);
         toast('Appointment canceled', {
            icon: <CheckCircle2 className="h-4 w-4" />,
         });
         router.refresh();
      },
      onError: () => {
         toast('Something went wrong', {
            icon: <Ban className="h-4 w-4" />,
         });
      },
   });

   const endAppointmentMutation = useMutation({
      mutationFn: endAppointment,
      onSuccess: () => {
         setOpen(false);
         toast('Appointment ended', {
            icon: <CheckCircle2 className="h-4 w-4" />,
         });
         router.refresh();
      },
      onError: () => {
         toast('Something went wrong', {
            icon: <Ban className="h-4 w-4" />,
         });
      },
   });

   return (
      <div className="flex flex-col border rounded-md p-6">
         <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
               <p className="text-sm text-muted-foreground">Appointment</p>

               <AppointmentStatusBadge status={appointment.status} />
            </div>

            <AppointmentDetailsBody appointment={appointment} />

            <div className="flex gap-2 w-full">
               {appointment.status == 'pending' && (
                  <LoadingButton
                     isLoading={checkInAppointmentMutation.isPending}
                     variant={'outline'}
                     className="w-[50%]"
                     onClick={() => checkInAppointmentMutation.mutate()}
                  >
                     {!checkInAppointmentMutation.isPending && (
                        <Check className="w-4 h-4 mr-2" />
                     )}
                     Check in
                  </LoadingButton>
               )}

               {!['pending', 'canceled', 'ended'].includes(
                  appointment.status,
               ) && (
                  <LoadingButton
                     variant={'outline'}
                     className="w-[50%]"
                     isLoading={endAppointmentMutation.isPending}
                     onClick={() => endAppointmentMutation.mutate()}
                  >
                     {!endAppointmentMutation.isPending && (
                        <XCircle className="w-4 h-4 mr-2" />
                     )}
                     End
                  </LoadingButton>
               )}

               {!['canceled', 'ended'].includes(appointment.status) && (
                  <LoadingButton
                     variant={'outline'}
                     className="w-[50%]"
                     isLoading={cancelAppointmentMutation.isPending}
                     onClick={() => cancelAppointmentMutation.mutate()}
                  >
                     {!cancelAppointmentMutation.isPending && (
                        <Ban className="w-4 h-4 mr-2" />
                     )}
                     Cancel
                  </LoadingButton>
               )}
            </div>
         </div>
      </div>
   );
};
