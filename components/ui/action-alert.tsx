import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge, BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trash } from 'lucide-react';

interface ActionAlertProps {
   title: string;
   description: string;
   variant: 'info' | 'warning' | 'danger';
   buttonText: string;
   onClick: React.MouseEventHandler<HTMLElement>;
   isLoading?: boolean;
}

const variantMap: Record<ActionAlertProps['variant'], BadgeProps['variant']> = {
   info: 'secondary',
   warning: 'secondary',
   danger: 'destructive',
};

export const ActionAlert: React.FC<ActionAlertProps> = ({
   title,
   description,
   variant = 'info',
   buttonText,
   onClick,
   isLoading,
}) => {
   return (
      <Alert className="border rounded-lg border-destructive bg-red-950">
         <AlertTitle className="mt-4 flex items-center">{title}</AlertTitle>
         <AlertDescription className="mb-4 flex items-center justify-between">
            {description}
            <Button
               variant={variant == 'danger' ? 'destructive' : 'default'}
               onClick={onClick}
               disabled={isLoading}
            >
               <Trash className="mr-2 h-4 w-4" /> {buttonText}
            </Button>
         </AlertDescription>
      </Alert>
   );
};
