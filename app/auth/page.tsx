'use client';

import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { SignUp } from '../sign-up';
import { useState } from 'react';
import { SignIn } from '../sign-in';

export default function Home() {
   const [isSignUp, setIsSignUp] = useState(false);

   const heroVariants = {
      hidden: {
         opacity: 0,
      },
      visible: {
         opacity: 1,
         transition: {
            delay: 0.2,
            duration: 1.4,
         },
      },
   };
   return (
      <div className="h-full flex">
         <div className="w-[50%] flex flex-col items-center justify-center h-full gap-12">
            <motion.div
               className="absolute right-4 bottom-8"
               variants={heroVariants}
               initial="hidden"
               animate="visible"
            >
               <h1 className="text-9xl text-muted-foreground">athena</h1>
            </motion.div>
            {isSignUp && (
               <Button
                  className="absolute right-4 top-4 md:right-8 md:top-8"
                  variant={'ghost'}
                  onClick={() => setIsSignUp(false)}
               >
                  Login
               </Button>
            )}
            <div className="w-full flex items-center justify-center">
               {isSignUp ? <SignUp /> : <SignIn setIsSignUp={setIsSignUp} />}
            </div>
         </div>

         <div className="h-full w-[50%] bg-card"></div>
      </div>
   );
}
