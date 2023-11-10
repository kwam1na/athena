'use client';

import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface OrganizationStepProps {
   organizationName: string;
   useSuggestedOrgName: boolean;
   isInvalidOrganizationName: boolean;
   onOrgNameChange: (value: string) => void;
   onUseSuggestedToggle: (checked: boolean) => void;
   suggestedOrgName: string;
}

export const OrganizationStep: React.FC<OrganizationStepProps> = ({
   organizationName,
   useSuggestedOrgName,
   isInvalidOrganizationName,
   onOrgNameChange,
   onUseSuggestedToggle,
   suggestedOrgName,
}) => {
   return (
      <>
         <div className="space-y-4">
            <h1 className="text-3xl text-left">Create your organization</h1>
         </div>
         <div className="flex flex-col gap-8 w-[60%]">
            <Input
               placeholder="Organization name"
               type="name"
               onChange={(e) => onOrgNameChange(e.target.value)}
               value={organizationName}
            />
            <div className="flex gap-4 items-center">
               <Switch
                  id="suggested-organization-name"
                  checked={useSuggestedOrgName}
                  onCheckedChange={onUseSuggestedToggle}
               />
               <Label htmlFor="suggested-organization-name">{`Use suggested name: ${suggestedOrgName}`}</Label>
            </div>
            {isInvalidOrganizationName && (
               <p className="text-sm text-destructive">
                  Please enter a valid name
               </p>
            )}
         </div>
      </>
   );
};
