import { InventoryNav } from './components/inventory-nav';

export default async function StoreLayout({
   children,
}: {
   children: React.ReactNode;
}) {
   return (
      <>
         <InventoryNav className="p-2 px-4 rounded-md" />
         <div className="h-full pt-6">{children}</div>
      </>
   );
}
