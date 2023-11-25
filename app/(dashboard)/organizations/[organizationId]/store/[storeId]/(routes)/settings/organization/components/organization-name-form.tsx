import * as z from 'zod';
import { useToast } from '@/components/ui/use-toast';
import { zodResolver } from '@hookform/resolvers/zod';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
   Form,
   FormControl,
   FormField,
   FormItem,
   FormLabel,
   FormMessage,
} from '@/components/ui/form';
import { LoadingButton } from '@/components/ui/loading-button';
import { apiUpdateOrganization } from '@/lib/api/organizations';
import { captureException } from '@sentry/nextjs';
import { Input } from '@/components/ui/input';

const organizationNameSchema = z.object({
   name: z.string().min(2),
});

type SettingsFormValues = z.infer<typeof organizationNameSchema>;

export const OrganizationNameForm = ({
   organizationName,
}: {
   organizationName?: string;
}) => {
   const params = useParams();
   const router = useRouter();
   const { toast } = useToast();

   const [updatingOrganization, setUpdatingOrganization] = useState(false);

   const form = useForm<SettingsFormValues>({
      resolver: zodResolver(organizationNameSchema),
      defaultValues: { name: organizationName || '' },
   });

   const onSubmit = async (data: SettingsFormValues) => {
      const body = {
         ...data,
         organization_id: parseInt(params.organizationId),
      };
      try {
         setUpdatingOrganization(true);
         await apiUpdateOrganization(params.organizationId, body);
         router.refresh();
         toast({
            title: 'Organization updated.',
         });
      } catch (error: any) {
         captureException(error);
         toast({
            title: 'Something went wrong. Try again.',
            description: (error as Error).message,
         });
      } finally {
         setUpdatingOrganization(false);
      }
   };

   return (
      <Form {...form}>
         <div className="space-y-4">
            <form
               onSubmit={form.handleSubmit(onSubmit)}
               className="space-y-8 w-full"
            >
               <div className="space-y-4">
                  <span className="text-md">Organizaiton details</span>
                  <div className="md:grid md:grid-cols-3 gap-8">
                     <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                           <FormItem>
                              <FormLabel>Name</FormLabel>
                              <FormControl>
                                 <Input
                                    disabled={updatingOrganization}
                                    placeholder="Organization name"
                                    {...field}
                                 />
                              </FormControl>
                              <FormMessage />
                           </FormItem>
                        )}
                     />
                  </div>
               </div>

               <LoadingButton
                  isLoading={updatingOrganization}
                  disabled={updatingOrganization}
                  className="ml-auto"
                  type="submit"
               >
                  {updatingOrganization ? 'Saving' : 'Save'}
               </LoadingButton>
            </form>
         </div>
      </Form>
   );
};
