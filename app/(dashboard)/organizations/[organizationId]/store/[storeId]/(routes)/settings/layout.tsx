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
         <SettingsNav className="pb-4 border-b" />
         <div className="h-full pt-6">{children}</div>
      </>
   );
}
