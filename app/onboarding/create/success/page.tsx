'use client';

import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { LocalStorageSync } from '@/lib/local-storage-sync';
import { useRouter } from 'next/navigation';
import { useOnboardingData } from '@/providers/onboarding-data-provider';

export default function OnboardingSuccess() {
   const router = useRouter();
   const onboardingAutoSaver = new LocalStorageSync('onboarding');
   const { organizationId, storeId } = useOnboardingData();

   const navigateToDashboard = () => {
      router.replace(`/organizations/${organizationId}/store/${storeId}`);
      onboardingAutoSaver.clearAll();
   };

   const containerVariants = {
      hidden: {
         opacity: 0,
         y: 16,
      },
      visible: {
         opacity: 1,
         y: 0,
         transition: {
            type: 'easeIn',
            duration: 0.6,
         },
      },
   };

   return (
      <div className="flex h-full">
         <motion.div
            className="flex flex-col h-full w-[50%] gap-32 px-16"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
         >
            <div className="flex flex-col gap-4 pt-32">
               <h1 className="text-3xl">
                  Congratulations! You've successfully added your first product
                  to your inventory.
               </h1>
               <h2 className="text-lg text-muted-foreground">
                  Keep the momentum going! Continue adding more items to keep
                  track of your store's operations.
               </h2>
            </div>

            <div>
               <Button onClick={navigateToDashboard}>
                  Go to your dashboard
               </Button>
            </div>
         </motion.div>
         <div className="flex w-[50%] p-32 bg-card"></div>
      </div>
   );
}
