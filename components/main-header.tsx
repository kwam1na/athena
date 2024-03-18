import Link from 'next/link';
import { UserNav } from './user-nav';
import StoreSwitcher from './store-switcher';
import { fetchStores } from '@/lib/repositories/storesRepository';
import { ThemeToggle } from './theme-toggle';

export const MainHeader = async () => {
   const stores = await fetchStores(
      'aa5f4c83-2e95-4429-bc47-9b90ece4a724',
      parseInt('1'),
   );

   return (
      <div className="w-full h-16 flex items-center justify-between border-b px-4">
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
