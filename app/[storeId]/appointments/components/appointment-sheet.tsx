'use client';

import {
   Sheet,
   SheetContent,
   SheetHeader,
   SheetTrigger,
} from '@/components/ui/sheet';
import { Appointment } from '@/lib/types';
import { useState } from 'react';
import { AppointmentActionTime } from './appointment-info';
import { AppointmentDetails } from './appointment-details';
import { AppointmentCustomerInformation } from './appointment-customer-information';
import { useStoreCurrency } from '@/providers/currency-provider';

export const AppointmentSheet = ({
   appointment,
   children,
}: {
   appointment: Appointment;
   children: React.ReactNode;
}) => {
   const [open, setOpen] = useState(false);
   const { storeCurrency } = useStoreCurrency();

   return (
      <Sheet open={open} onOpenChange={setOpen}>
         <SheetTrigger asChild>{children}</SheetTrigger>
         <SheetContent className="space-y-4 pt-12">
            <SheetHeader>
               <p className="text-sm font-semibold">Appointment details</p>
               <AppointmentActionTime appointment={appointment} />
            </SheetHeader>
            <AppointmentDetails
               appointment={appointment}
               setOpen={setOpen}
               currency={storeCurrency}
            />
            <AppointmentCustomerInformation appointment={appointment} />
         </SheetContent>
      </Sheet>
   );
};
