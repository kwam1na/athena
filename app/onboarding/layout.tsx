import { redirect } from 'next/navigation';
import '../globals.css';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { ThemeProvider } from '@/providers/theme-provider';
import { OnboardingDataProvider } from '@/providers/onboarding-data-provider';
import { UserProvider } from '@/providers/user-provider';
export const dynamic = 'force-dynamic';

export default async function OnboardingLayout({
   children,
}: {
   children: React.ReactNode;
}) {
   console.debug('[OnboardingLayout] beginning operations');

   const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
         cookies: {
            get(name: string) {
               return cookies().get(name)?.value;
            },
         },
      },
   );

   const {
      data: { session },
   } = await supabase.auth.getSession();
   const user = session?.user;

   if (!user) {
      redirect('/auth');
   }

   return (
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
         <UserProvider>
            <OnboardingDataProvider>{children}</OnboardingDataProvider>
         </UserProvider>
      </ThemeProvider>
   );
}
