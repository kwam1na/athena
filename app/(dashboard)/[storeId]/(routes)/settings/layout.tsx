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
         <div className="pl-8 pt-4 pb-8">
            <SettingsNav />
         </div>
         <div className="h-full">{children}</div>
      </>
   );
}
