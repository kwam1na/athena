import { InventoryNav } from './components/inventory-nav';

export default async function StoreLayout({
   children,
}: {
   children: React.ReactNode;
}) {
   return (
      <>
         <InventoryNav className="pb-4 border-b" />
         <div className="h-full pt-6">{children}</div>
      </>
   );
}
