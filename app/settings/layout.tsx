import { Sidebar } from '@/components/sidebar';
import { SettingsHeader } from './components/settings-heaader';

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
                  href: `/settings/store`,
                  aliases: ['/settings'],
                  label: 'Store',
               },
               {
                  href: `/settings/profile`,
                  label: 'Profile',
               },
            ]}
         >
            {children}
         </Sidebar>
      </section>
   );
}
