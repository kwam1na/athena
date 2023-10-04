import { redirect } from 'next/navigation';
import prismadb from '@/lib/prismadb';
import { ErrorPage } from '@/components/states/error';
import { getSession } from '@auth0/nextjs-auth0';

export default async function SetupLayout({
   children,
}: {
   children: React.ReactNode;
}) {
   console.log('[RootSetupLayout] beginning operations');

   const session = await getSession();
   const user = session?.user;

   if (!user) {
      console.log('[RootSetupLayout] no userId, redirecting to /sign-in');
      redirect('/api/auth/login');
   }

   console.log('[RootSetupLayout] user returned from auth0:', user);

   const existingUser = await prismadb.user.findFirst({
      where: {
         email: user.email,
      },
   });

   if (!existingUser) {
      console.log('[RootSetupLayout] no user saved. creating new one..');
      await prismadb.user.create({
         data: {
            id: user.sub,
            email: user.email,
            name: user.name,
         },
      });
   }

   let store;
   try {
      store = await prismadb.store.findFirst({
         where: {
            user_id: user.sub,
         },
      });
   } catch (error) {
      console.error('[RootSetupLayout error]', error);
      return <ErrorPage title="Unable to connect to server" />;
   }

   if (store) {
      console.log('[RootSetupLayout] store found. redirecting to /[storeId]');
      redirect(`/${store.id}`);
   }

   console.log('[RootSetupLayout] no store. rendering UserProvider');
   return <>{children}</>;
}
