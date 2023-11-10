'use client';

import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from './alert';
import { Button } from './button';
import { useParams, useRouter } from 'next/navigation';

interface TaskAlertProps {
   title: string;
   description?: string;
   action?: {
      type: 'navigate' | 'handler';
      ctaText: string;
      handler?: () => void;
      route?: string;
   };
}

export const TaskAlert: React.FC<TaskAlertProps> = ({
   action,
   description,
   title,
}) => {
   const router = useRouter();

   const handleAction = () => {
      if (action?.type === 'navigate') {
         action.route && router.push(action.route);
      } else if (action?.type === 'handler') {
         action.handler && action.handler();
      }
   };
   return (
      <Alert className="flex justify-between bg-card">
         <div className="flex gap-2 pt-4 pb-4">
            <AlertCircle className="h-4 w-4" />
            <div className="grid grid-rows-2 gap-2">
               <AlertTitle>{title}</AlertTitle>
               {description && (
                  <AlertDescription>{description}</AlertDescription>
               )}
            </div>
         </div>
         {action && (
            <Button className="mt-4" variant={'outline'} onClick={handleAction}>
               {action.ctaText}
            </Button>
         )}
      </Alert>
   );
};
