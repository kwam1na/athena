'use client';

import { Button } from '@/components/ui/button';
import { InnerHeader } from '@/components/ui/inner-header';
import { ChevronLeft, Plus } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';

export const AppointmentsHeader = () => {
   const router = useRouter();
   const pathname = usePathname();

   const pathIncludes = (subPath: string) => pathname.includes(subPath);
   const isOnNewOrEditPage =
      pathIncludes('/services/new') || pathIncludes('/edit');

   return (
      <InnerHeader>
         <div className="flex items-center gap-2">
            {isOnNewOrEditPage && (
               <Button
                  variant={'ghost'}
                  size={'sm'}
                  onClick={() => router.back()}
               >
                  <ChevronLeft className="h-4 w-4" />
               </Button>
            )}
            <p className="text-sm font-semibold flex gap-2 items-center pl-12">
               Appointments
               {isOnNewOrEditPage && (
                  <span className="text-muted-foreground">
                     / {pathIncludes('/services/new') ? 'New' : 'Edit'}
                  </span>
               )}
            </p>
         </div>
      </InnerHeader>
   );
};
