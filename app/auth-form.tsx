'use client';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa, ThemeMinimal } from '@supabase/auth-ui-shared';
// import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Database } from '../lib/database.types';
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export default function AuthForm() {
   const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
   );

   const [isMounted, setIsMounted] = useState(false);

   useEffect(() => {
      setIsMounted(true);
   }, []);

   if (!isMounted) {
      return null;
   }

   const customTheme = {
      default: {
         colors: {
            brand: 'white',
            brandAccent: 'black',
            brandButtonText: 'black',
         },
      },
      dark: {
         colors: {
            brandButtonText: 'black',
            defaultButtonBackground: 'yellow',
            defaultButtonBackgroundHover: 'blue',
            inputBorder: 'black',
         },
      },
   };
   return (
      <Auth
         supabaseClient={supabase}
         view="magic_link"
         appearance={{ theme: ThemeSupa }}
         theme="dark"
         //  showLinks={false}
         providers={[]}
         redirectTo="http://localhost:8080/auth/callback"
      />
   );
}
