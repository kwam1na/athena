import { EmptyState } from '@/components/states/empty/empty-state';
import { FileQuestion } from 'lucide-react';

export default function UnauthorizedRoute() {
   return (
      <div className="flex h-full items-center">
         <div className="flex-1 space-y-6">
            <EmptyState
               icon={
                  <FileQuestion
                     size={'112px'}
                     color="#5C5C5C"
                     strokeWidth={'1px'}
                  />
               }
               action={{
                  ctaText: 'Go to your dashboard',
                  type: 'navigate',
                  params: {
                     url: '/',
                  },
               }}
               text="Looks like you navigated to a wrong page."
               hideButtonIcon
            />
         </div>
      </div>
   );
}
