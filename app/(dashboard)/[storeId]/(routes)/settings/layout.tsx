import { SettingsNav } from './components/settings-nav';

export default async function StoreLayout({
   children,
   params,
}: {
   children: React.ReactNode;
   params: { storeId: string };
}) {
   return (
      <>
         <div className="pt-4 pb-8 border-b">
            <SettingsNav />
         </div>
         <div className="h-full">{children}</div>
      </>
   );
}
