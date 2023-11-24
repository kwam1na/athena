import { Lightbulb } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from './alert';
import { cn } from '@/lib/utils';

interface ProductTipProps {
   tip: string;
   className?: string;
}

const ProductTip: React.FC<ProductTipProps> = ({ className, tip }) => {
   return (
      <Alert className={cn('flex justify-between h-[180px]', className)}>
         <div className="flex flex-col gap-8 pt-4">
            <div className="flex gap-1">
               <Lightbulb className="h-4 w-4 text-[#ffd700]" />
               <AlertTitle className="text-[#ffd700]">{'Tip'}</AlertTitle>
            </div>
            <AlertDescription className="pr-8">{tip}</AlertDescription>
         </div>
      </Alert>
   );
};

export default ProductTip;
