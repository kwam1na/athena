'use client';

import { Separator } from '@/components/ui/separator';
import { Heading } from '@/components/ui/heading';

import { ThemeToggle } from '@/components/theme-toggle';
import { Label } from '@/components/ui/label';
import { motion } from 'framer-motion';
import {
   mainContainerVariants,
   widgetVariants,
} from '@/lib/animation/constants';

export const PreferencesForm = () => {
   return (
      <>
         <motion.div
            className="space-y-4"
            variants={widgetVariants}
            initial="hidden"
            animate="visible"
         >
            <Label className="text-lg">Preferences</Label>
            <Separator />
         </motion.div>

         <motion.div
            className="space-y-8"
            variants={mainContainerVariants}
            initial="hidden"
            animate="visible"
         >
            <div className="md:grid md:grid-rows-3">
               {/* <Sun className="mr-2 h-[1rem] w-[1rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" /> */}
               {/* <Moon className="mr-2 absolute h-[1rem] w-[1rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" /> */}
               <span>Appearance</span>
               <div>
                  <ThemeToggle />
               </div>
            </div>
         </motion.div>
      </>
   );
};
