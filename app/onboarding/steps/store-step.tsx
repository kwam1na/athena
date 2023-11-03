'use client';

import { Input } from '@/components/ui/input';
import {
   SelectTrigger,
   Select,
   SelectValue,
   SelectContent,
   SelectItem,
} from '@/components/ui/select';

interface StoreStepProps {
   storeName: string;
   isInvalidStoreName: boolean;
   disabled?: boolean;
   currency: string;
   onStoreNameChange: (value: string) => void;
   onCurrencyChange: (value: string) => void;
   currencies: { label: string; value: string }[];
}

export const StoreStep: React.FC<StoreStepProps> = ({
   disabled,
   storeName,
   isInvalidStoreName,
   currency,
   onStoreNameChange,
   onCurrencyChange,
   currencies,
}) => {
   return (
      <>
         <div className="space-y-4">
            <h1 className="text-3xl text-left">Create your first store</h1>
         </div>
         <div className="flex gap-4 w-[60%]">
            <div className="flex flex-col w-full gap-4">
               <Input
                  placeholder="Acme Inc."
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
               <Select
                  onValueChange={onCurrencyChange}
                  value={currency}
                  disabled={disabled}
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
      </>
   );
};
