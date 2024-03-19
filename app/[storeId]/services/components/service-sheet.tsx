'use client';

import {
   Sheet,
   SheetContent,
   SheetHeader,
   SheetTrigger,
} from '@/components/ui/sheet';
import { Service } from '@/lib/types';
import { useState } from 'react';
import { ServiceForm } from './service-form';

export const ServiceSheet = ({
   service,
   children,
}: {
   service?: Service;
   children: React.ReactNode;
}) => {
   const [open, setOpen] = useState(false);

   return (
      <Sheet open={open} onOpenChange={setOpen}>
         <SheetTrigger asChild>{children}</SheetTrigger>
         <SheetContent className="space-y-4 pt-12">
            <SheetHeader>
               <p className="text-sm font-semibold">
                  {service ? 'Service information' : 'Add new service'}
               </p>
            </SheetHeader>
            <ServiceForm
               service={service}
               onFormSubmit={() => setOpen(false)}
            />
         </SheetContent>
      </Sheet>
   );
};
