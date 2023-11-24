import { InfoCircledIcon } from '@radix-ui/react-icons';
import {
   Tooltip,
   TooltipContent,
   TooltipProvider,
   TooltipTrigger,
} from './tooltip';

interface InfoTooltipProps {
   label: React.ReactNode | string;
   tooltip: string;
}

const InfoTooltip: React.FC<InfoTooltipProps> = ({ label, tooltip }) => {
   return (
      <TooltipProvider>
         <Tooltip>
            <TooltipTrigger asChild>
               <div className="flex items-center">
                  {typeof label == 'string' ? (
                     <p className="text-sm">{label}</p>
                  ) : (
                     label
                  )}
                  <InfoCircledIcon className="h-4 w-4 ml-1 text-muted-foreground" />
               </div>
            </TooltipTrigger>
            <TooltipContent>
               <p>{tooltip}</p>
            </TooltipContent>
         </Tooltip>
      </TooltipProvider>
   );
};

export default InfoTooltip;
