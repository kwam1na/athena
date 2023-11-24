'use client';

import { Input } from '@/components/ui/input';
import {
   SelectTrigger,
   Select,
   SelectValue,
   SelectContent,
   SelectItem,
} from '@/components/ui/select';
import {
   Tooltip,
   TooltipContent,
   TooltipProvider,
   TooltipTrigger,
} from '@/components/ui/tooltip';
import { Label } from '@/components/ui/label';
import { InfoCircledIcon } from '@radix-ui/react-icons';

interface StoreStepProps {
   storeName: string;
   isInvalidStoreName: boolean;
   lowStockThreshold?: number;
   isInvalidLowStockThreshold: boolean;
   disabled?: boolean;
   currency: string;
   onStoreNameChange: (value: string) => void;
   onCurrencyChange: (value: string) => void;
   onLowStockThresholdChange: (value: string) => void;
   currencies: { label: string; value: string }[];
}

export const StoreStep: React.FC<StoreStepProps> = ({
   disabled,
   storeName,
   isInvalidStoreName,
   lowStockThreshold,
   isInvalidLowStockThreshold,
   currency,
   onStoreNameChange,
   onCurrencyChange,
   onLowStockThresholdChange,
   currencies,
}) => {
   return (
      <>
         <div className="space-y-4">
            <h1 className="text-3xl text-left">Create your first store</h1>
         </div>
         <div className="flex gap-4 w-[60%]">
            <div className="flex flex-col w-full gap-4">
               <Label>Store name</Label>
               <Input
                  placeholder="Your store name"
                  type="name"
                  onChange={(e) => onStoreNameChange(e.target.value)}
                  value={storeName}
                  disabled={disabled}
               />
               {isInvalidStoreName && (
                  <p className="text-sm text-destructive">
                     Please enter a valid name
                  </p>
               )}
            </div>

            <div className="flex flex-col w-full gap-4">
               <Label>Currency</Label>
               <Select
                  onValueChange={onCurrencyChange}
                  value={currency}
                  disabled={disabled}
                  defaultValue="Select a currency"
               >
                  <SelectTrigger>
                     <SelectValue placeholder="Select a currency" />
                  </SelectTrigger>
                  <SelectContent>
                     {currencies.map((currency) => (
                        <SelectItem key={currency.value} value={currency.value}>
                           {currency.label}
                        </SelectItem>
                     ))}
                  </SelectContent>
               </Select>
            </div>
         </div>

         <div className="flex gap-4 w-[60%]">
            <div className="flex flex-col gap-4">
               <TooltipProvider>
                  <Tooltip>
                     <TooltipTrigger asChild>
                        <div className="flex items-center gap-1">
                           <Label>Low stock threshold</Label>
                           <InfoCircledIcon className="h-4 w-4 ml-1 text-muted-foreground" />
                        </div>
                     </TooltipTrigger>
                     <TooltipContent>
                        <p>
                           This is a number that will be used to determine when
                           to alert you that you are running low on stock.
                        </p>
                     </TooltipContent>
                  </Tooltip>
               </TooltipProvider>
               <Input
                  placeholder="Enter number"
                  type="number"
                  onChange={(e) => onLowStockThresholdChange(e.target.value)}
                  value={lowStockThreshold}
                  disabled={disabled}
               />
               {isInvalidLowStockThreshold && (
                  <p className="text-sm text-destructive">
                     Please enter a valid number
                  </p>
               )}
            </div>
         </div>
      </>
   );
};
