import { InnerHeader } from '@/components/ui/inner-header';

export const SettingsHeader = () => {
   return (
      <InnerHeader>
         <div className="flex items-center gap-2">
            <p className="text-sm font-semibold flex gap-2 items-center pl-12">
               Settings
            </p>
         </div>
      </InnerHeader>
   );
};
