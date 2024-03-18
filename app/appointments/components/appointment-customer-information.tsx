import { InfoLine } from '@/components/info-line';
import { Button } from '@/components/ui/button';
import { Appointment } from '@/lib/types';
import { AtSign, Mail, Phone, User } from 'lucide-react';

const AppointmentCustomerDetailsActionButtons = ({
   appointment,
}: {
   appointment: Appointment;
}) => {
   return (
      <div className="flex gap-2 w-full">
         <a
            className="w-[50%]"
            href={`tel:${appointment.customer.phone_number}`}
         >
            <Button className="w-full" variant={'outline'}>
               Call
            </Button>
         </a>

         <a className="w-[50%]" href={`mailto:${appointment.customer.email}`}>
            <Button className="w-full" variant={'outline'}>
               Email
            </Button>
         </a>
      </div>
   );
};

const AppointmentCustomerDetailsBody = ({
   appointment,
}: {
   appointment: Appointment;
}) => {
   return (
      <div className="flex flex-col gap-4">
         <InfoLine
            icon={<User className="w-4 h-4 text-muted-foreground" />}
            text={`${appointment.customer?.first_name} ${appointment.customer?.last_name}`}
         />

         <InfoLine
            icon={<AtSign className="w-4 h-4 text-muted-foreground" />}
            text={appointment.customer?.email}
         />

         <InfoLine
            icon={<Phone className="w-4 h-4 text-muted-foreground" />}
            text={appointment.customer?.phone_number}
         />
      </div>
   );
};

export const AppointmentCustomerInformation = ({
   appointment,
}: {
   appointment: Appointment;
}) => {
   return (
      <div className="flex flex-col border rounded-md p-6">
         <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">Customer</p>

            <AppointmentCustomerDetailsBody appointment={appointment} />
            <AppointmentCustomerDetailsActionButtons
               appointment={appointment}
            />
         </div>
      </div>
   );
};
