import { cn } from '@/lib/utils';

export const CardContainer = ({
   className,
   ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
   return (
      <div
         className={cn(
            'flex items-center justify-center [&>div]:w-full',
            className,
         )}
         {...props}
      />
   );
};
