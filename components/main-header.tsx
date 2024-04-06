import Link from 'next/link';
import { UserNav } from './user-nav';
import StoreSwitcher from './store-switcher';
import { fetchStores } from '@/lib/repositories/storesRepository';

export const MainHeader = async () => {
   const stores = await fetchStores(parseInt('1'));

   return (
      <div className="w-full h-16 flex items-center justify-between border-b px-4 backdrop-blur-md bg-opacity-30 justify-between fixed top-0 z-40">
         <div className="flex items-center gap-4">
            <Link href={'/'} className="flex items-center">
               <p className="text-sm font-medium">athena</p>
            </Link>
            <p className="text-muted-foreground">/</p>
            <StoreSwitcher items={stores} />
         </div>
         <div className="flex items-center">
            <UserNav />
         </div>
      </div>
   );
};
