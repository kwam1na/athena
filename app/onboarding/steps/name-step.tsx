'use client';

import { Input } from '@/components/ui/input';

interface NameStepProps {
   name: string;
   isInvalidName: boolean;
   onNameChange: (value: string) => void;
}

export const NameStep: React.FC<NameStepProps> = ({
   name,
   isInvalidName,
   onNameChange,
}) => {
   return (
      <>
         <div className="space-y-4">
            <h1 className="text-3xl text-left">
               Welcome to athena. Let's get started.
            </h1>
         </div>
         <div className="flex flex-col gap-4 w-[60%]">
            <Input
               placeholder="Your name"
               type="name"
               onChange={(e) => onNameChange(e.target.value)}
               value={name}
            />
            {isInvalidName && (
               <p className="text-sm text-destructive">
                  Please enter a valid name
               </p>
            )}
         </div>
      </>
   );
};
