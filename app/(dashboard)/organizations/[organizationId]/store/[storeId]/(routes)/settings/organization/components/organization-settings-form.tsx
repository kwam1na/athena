'use client';

import { organization } from '@prisma/client';
import { motion } from 'framer-motion';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import {
   mainContainerVariants,
   widgetVariants,
} from '@/lib/animation/constants';
import { OrganizationMembers } from './organization-members';
import { OrganizationNameForm } from './organization-name-form';

interface OrganizationSettingsFormProps {
   initialData: organization;
}

export const OrganizationSettingsForm: React.FC<
   OrganizationSettingsFormProps
> = ({ initialData }) => {
   return (
      <>
         <motion.div
            className="space-y-4"
            variants={widgetVariants}
            initial="hidden"
            animate="visible"
         >
            <Label className="text-lg">Organization settings</Label>
            <Separator />
         </motion.div>

         <motion.div
            className="space-y-8"
            variants={mainContainerVariants}
            initial="hidden"
            animate="visible"
         >
            <OrganizationNameForm organizationName={initialData?.name} />

            <OrganizationMembers
               organizationName={initialData?.name}
               // @ts-expect-error: TODO: Fix type
               members={initialData?.members || []}
            />
         </motion.div>
      </>
   );
};
