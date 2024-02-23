import { SettingsNav } from './components/settings-nav';

export default async function StoreLayout({
   children,
   params,
}: {
   children: React.ReactNode;
   params: { storeId: string };
}) {
   return (
      <div className="space-y-4">
         <SettingsNav className="p-2 px-6 rounded-md" />
         <div className="h-full pt-6">{children}</div>
      </div>
   );
}
