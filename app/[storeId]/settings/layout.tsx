import { Sidebar } from '@/components/sidebar';
import { SettingsHeader } from './components/settings-heaader';
import { CurrencyProvider } from '@/providers/currency-provider';

export default async function SettingsLayout({
   children,
}: {
   children: React.ReactNode;
}) {
   return (
      <section className="w-full h-screen">
         <SettingsHeader />
         <Sidebar
            sideNavClassName="bg-card"
            routes={[
               {
                  href: `/1/settings/store`,
                  aliases: ['/1/settings'],
                  label: 'Store',
               },
               {
                  href: `/1/settings/profile`,
                  label: 'Profile',
               },
            ]}
         >
            {children}
         </Sidebar>
      </section>
   );
}
