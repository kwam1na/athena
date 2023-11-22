import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader } from './card';

const InfoCard = ({
   title,
   className,
   children,
}: {
   title: string;
   className?: string;
   children: React.ReactNode;
}) => {
   return (
      <Card className="bg-background">
         <CardHeader>
            <CardDescription>{title}</CardDescription>
         </CardHeader>
         <CardContent className={cn('grid gap-6', className)}>
            {children}
         </CardContent>
      </Card>
   );
};

export default InfoCard;
