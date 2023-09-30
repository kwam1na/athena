import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge, BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

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
      <Alert style={{ background: 'darkred' }}>
         <AlertTitle className="mt-4 flex items-center">{title}</AlertTitle>
         <AlertDescription className="mb-4 flex items-center justify-between">
            {description}
            <Button
               variant={variant == 'danger' ? 'destructive' : 'default'}
               size="sm"
               onClick={onClick}
               disabled={isLoading}
            >
               {buttonText}
            </Button>
         </AlertDescription>
      </Alert>
   );
};
