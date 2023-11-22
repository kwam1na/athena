'use client';

import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import libraryImage from '../../assets/books-clear.png';
import { LibrarySVG } from '@/app/assets/library';

export default function OnboardingCreate() {
   const router = useRouter();

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

   const buttonVariants = {
      hidden: {
         opacity: 0,
         x: -24,
      },
      visible: {
         opacity: 1,
         x: 0,
         transition: {
            type: 'easeIn',
            duration: 0.6,
            delay: 1.4,
         },
      },
   };

   const blurbVariants = {
      hidden: {
         opacity: 0,
         // y: 8,
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
               <h1 className="text-3xl">Your first store is set up!</h1>
               <h2 className="text-lg text-muted-foreground">
                  Let's start building your inventory with athena
               </h2>
            </div>

            <div className="flex flex-col gap-16">
               <h2 className="text-lg leading-relaxed">
                  In athena, managing your inventory is as straightforward as
                  organizing a library. Think of categories as the main genres
                  like Science or History, each holding a variety of items.
                  Subcategories are like specific bookshelves, organizing these
                  items for easy access. And your products? They are the
                  individual books, each with unique details. Let's create your
                  first category and fill your shelves with products.
               </h2>

               <motion.div
                  variants={buttonVariants}
                  initial="hidden"
                  animate="visible"
               >
                  <Button
                     onClick={() => router.push('/onboarding/create/category')}
                  >
                     Get started
                  </Button>
               </motion.div>
            </div>
         </motion.div>
         <div className="flex w-[50%] p-32 bg-card justify-center"></div>
      </div>
   );
}
