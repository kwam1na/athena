'use client';

import { Button } from '@/components/ui/button';
import { ChevronLeft, Plus } from 'lucide-react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { InnerHeader } from '@/components/ui/inner-header';
import Link from 'next/link';

export const ServicesHeader = () => {
   const router = useRouter();
   const params = useParams();
   const pathname = usePathname();

   const id = pathname.split('/').at(-1);

   const pathIncludes = (subPath: string) => pathname.includes(subPath);
   const isOnNewOrEditPage =
      id == 'new' || !['services', 'active', 'archived'].includes(id || '');

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
            <p
               className={`text-sm font-semibold flex gap-2 items-center ${
                  !isOnNewOrEditPage ? 'pl-12' : ''
               }`}
            >
               Services
               {isOnNewOrEditPage && (
                  <span className="text-muted-foreground">
                     / {pathIncludes('/services/new') ? 'New' : 'Edit'}
                  </span>
               )}
            </p>
         </div>
         {!isOnNewOrEditPage && (
            <Link href={`/${params.storeId}/services/new`} className="ml-auto">
               <Button variant={'ghost'} size={'sm'}>
                  <Plus className="h-4 w-4" />
               </Button>
            </Link>
         )}
      </InnerHeader>
   );
};
