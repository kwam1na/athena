'use client';

import { Button } from '@/components/ui/button';
import AuthForm from '../auth-form';
import { SignUp } from '../sign-up';
import { useState } from 'react';
import { SignIn } from '../sign-in';

export default function Home() {
   const [isSignUp, setIsSignUp] = useState(false);
   return (
      <div className="h-full flex">
         <div className="w-[50%] flex flex-col items-center justify-center h-full gap-12">
            <div className="absolute right-4 bottom-8">
               <h1 className="text-9xl text-muted-foreground">athena</h1>
            </div>
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
