import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { LayoutDashboard, Package, Settings, ShoppingBag } from 'lucide-react';

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
   storeId: string;
}

export const Sidebar = async ({ className, storeId }: SidebarProps) => {
   return (
      <div className={cn('pb-12', className)}>
         <div className="py-4">
            <div className="px-3 py-2">
               <div className="space-y-1">
                  <Link href={`/${storeId}`}>
                     <Button variant="ghost" className="w-full justify-start">
                        <LayoutDashboard className="mr-2 h-4 w-4" /> Dashboard
                     </Button>
                  </Link>

                  <Link href={`/${storeId}/inventory/products`}>
                     <Button variant="ghost" className="w-full justify-start">
                        <Package className="mr-2 h-4 w-4" /> Inventory
                     </Button>
                  </Link>

                  <Link href={`/${storeId}/orders`}>
                     <Button variant="ghost" className="w-full justify-start">
                        <ShoppingBag className="mr-2 h-4 w-4" /> Orders
                     </Button>
                  </Link>

                  <Link href={`/${storeId}/settings`}>
                     <Button variant="ghost" className="w-full justify-start">
                        <Settings className="mr-2 h-4 w-4" /> Settings
                     </Button>
                  </Link>
               </div>
            </div>
         </div>
      </div>
   );
};
