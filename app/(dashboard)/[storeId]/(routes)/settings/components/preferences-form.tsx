'use client';

import * as z from 'zod';
import { Store } from '@prisma/client';
import { Separator } from '@/components/ui/separator';
import { Heading } from '@/components/ui/heading';

import { ThemeToggle } from '@/components/theme-toggle';

const formSchema = z.object({
   name: z.string().min(2),
   currency: z.string().min(3),
});

type PreferencesFormValues = z.infer<typeof formSchema>;

interface PreferencesFormProps {
   initialData: Store;
}

export const PreferencesForm: React.FC<PreferencesFormProps> = ({
   initialData,
}) => {
   return (
      <>
         <div className="flex items-center justify-between">
            <Heading
               title="Preferences"
               description="Manage your preferences"
            />
         </div>
         <Separator />
         <div className="md:grid md:grid-rows-3">
            {/* <Sun className="mr-2 h-[1rem] w-[1rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" /> */}
            {/* <Moon className="mr-2 absolute h-[1rem] w-[1rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" /> */}
            <span>Appearance</span>
            <div>
               <ThemeToggle />
            </div>
         </div>
      </>
   );
};
