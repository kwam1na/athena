'use client';

import * as z from 'zod';
import { captureException } from '@sentry/nextjs';
import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Ban, CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import {
   Form,
   FormControl,
   FormDescription,
   FormField,
   FormItem,
   FormLabel,
   FormMessage,
} from '@/components/ui/form';
import { AlertModal } from '@/components/modals/alert-modal';
import { Checkbox } from '@/components/ui/checkbox';
import { CardContainer } from '@/components/ui/card-container';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useStoreCurrency } from '@/providers/currency-provider';
import { LoadingButton } from '@/components/ui/loading-button';
import { ActionModal } from '@/components/modals/action-modal';
import { motion } from 'framer-motion';
import { hours, mainContainerVariants } from '@/lib/constants';
import { Label } from '@/components/ui/label';
import { ServicesAutosaver } from '../utils/services-autosaver';
import {
   apiCreateService,
   apiDeleteService,
   apiUpdateService,
} from '@/lib/api/services';
import { Switch } from '@/components/ui/switch';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Service } from '@/lib/types';
import { useMutation } from '@tanstack/react-query';

enum ActionContext {
   NONE,
   LEAVING,
   DELETING,
}

const formSchema = z.object({
   name: z.string().min(1),
   start_time: z.string().min(1),
   end_time: z.string().min(1),
   price: z.coerce.number().min(1),
   is_active: z.boolean().default(true),
   is_archived: z.boolean().default(false),
});

type ServiceFormValues = z.infer<typeof formSchema>;

interface ServiceFormProps {
   service?: Service;
   onFormSubmit?: Function;
}

interface TimeOption {
   label: string; // Human-readable time
   value: number; // Timestamp
}

const ServiceInfoCard = ({
   title,
   description,
   className,
   children,
}: {
   title: string;
   description?: string;
   className?: string;
   children: React.ReactNode;
}) => {
   return (
      <Card className="bg-background">
         <CardHeader>
            <p className="text-sm">{title}</p>
            <p className="text-muted-foreground text-sm">{description}</p>
         </CardHeader>
         <CardContent className={cn('grid gap-6', className)}>
            {children}
         </CardContent>
      </Card>
   );
};

const IntervalSwitches = ({
   interval,
   setInterval,
}: {
   interval: 'hour' | 'halfHour';
   setInterval: (interval: 'hour' | 'halfHour') => void;
}) => {
   return (
      <div className="flex flex-col w-[70%] gap-4">
         <p className="text-sm text-muted-foreground">
            How long should time slots be spaced out?
         </p>
         <div className="flex gap-4 items-center justify-between">
            <Label htmlFor="suggested-organization-name">Hour intervals</Label>
            <Switch
               id="suggested-organization-name"
               checked={interval === 'hour'}
               onCheckedChange={() => setInterval('hour')}
            />
         </div>

         <div className="flex gap-4 items-center justify-between">
            <Label htmlFor="suggested-organization-name">
               30-minute intervals
            </Label>
            <Switch
               id="suggested-organization-name"
               checked={interval === 'halfHour'}
               onCheckedChange={() => setInterval('halfHour')}
            />
         </div>
      </div>
   );
};

export const ServiceForm: React.FC<ServiceFormProps> = ({
   service,
   onFormSubmit,
}) => {
   const router = useRouter();

   const { storeCurrency } = useStoreCurrency();

   const [open, setOpen] = useState(false);
   const [loading, setLoading] = useState(false);
   const [isAutosavedModalOpen, setIsAutosavedModalOpen] = useState(false);
   const [isMounted, setIsMounted] = useState(false);
   const [isValidAppointmentTime, setIsValidAppointmentTime] = useState(true);
   const [appointmentsInterval, setAppointmentsInterval] = useState<
      'hour' | 'halfHour'
   >((service?.interval_type as 'hour' | 'halfHour') || 'hour');

   const [actionContext, setActionContext] = useState(ActionContext.NONE);

   const action = service ? 'Save changes' : 'Create';
   const loadingAction = loading ? (service ? 'Saving' : 'Creating') : '';
   const buttonText = loading ? loadingAction : action;

   const entryAction = service ? 'edit' : 'new';
   const serviceAutosaver = new ServicesAutosaver('1', entryAction);

   const searchParams = new URLSearchParams(window.location.search);
   const productName = searchParams.get('query');

   console.log(service);

   const defaultValues: Record<string, any> = service
      ? {
           ...service,
           price: parseFloat(String(service?.price)),
        }
      : {
           name: productName || '',
           price: Number('a'),
           start_time: '',
           end_time: '',
           interval_type: 'hour',
           is_active: true,
           is_archived: false,
        };

   const form = useForm<ServiceFormValues>({
      resolver: zodResolver(formSchema),
      // @ts-ignore
      defaultValues,
   });

   const hasFormChanged = (formValues: any) => {
      return Object.keys(defaultValues).some((key) => {
         if (
            Number.isNaN(formValues[key]) &&
            Number.isNaN(defaultValues[key])
         ) {
            return false;
         }
         return formValues[key] !== defaultValues[key];
      });
   };

   const [hasChanges, setHasChanges] = useState(
      hasFormChanged(form.getValues()),
   );

   const watchedValues = form.watch();

   /**
    * Autosave product
    */
   const autosaveService = () => {
      serviceAutosaver.save(form.getValues());
   };

   /**
    * Delete product handler
    */
   const onDelete = async () => {
      if (!service) return;
      try {
         setLoading(true);
         await apiDeleteService(service?.id, '1');
         router.refresh();
         toast('Service deleted.');
      } catch (error: any) {
         captureException(error);
         toast('Something went wrong deleting this service. Try again.');
      } finally {
         setLoading(false);
         setOpen(false);
      }
   };

   const submitData = async (data: object) => {
      if (service) {
         await apiUpdateService(service.id, '1', data);
      } else {
         await apiCreateService('1', data);
      }
   };

   const updateMutation = useMutation({
      mutationFn: (data: object) => submitData(data),
      onSuccess: () => {
         toast(`Service ${service ? 'updated' : 'created'}`, {
            icon: <CheckCircle2 className="w-4 h-4" />,
         });
         router.refresh();
         serviceAutosaver.clearAll();
      },
      onError: () => {
         toast('Something went wrong', { icon: <Ban className="w-4 h-4" /> });
      },
      onSettled: () => {
         onFormSubmit?.();
      },
   });

   /**
    * Submit product handler
    */
   const onSubmit = async (data: ServiceFormValues) => {
      const cleanedUpData = {
         ...data,
         store_id: parseInt('1'),
         interval_type: appointmentsInterval,
         currency: storeCurrency,
         organization_id: parseInt('1'),
         is_active: data.is_archived ? false : true,
      };

      updateMutation.mutate(cleanedUpData);
   };

   /**
    * Use autosaved product
    */
   const useAutosavedService = () => {
      const draftService = serviceAutosaver.getAll();
      form.reset(draftService);

      setIsAutosavedModalOpen(false);
   };

   /**
    * Discard autosaved product
    */
   const discardAutosavedService = () => {
      serviceAutosaver.clearAll();
      setIsAutosavedModalOpen(false);
   };

   useEffect(() => {
      const autosavedProduct = serviceAutosaver.getAll();
      if (!service && Object.keys(autosavedProduct).length > 0) {
         setIsAutosavedModalOpen(true);
      }

      const searchParams = new URLSearchParams(window.location.search);
      const repopulate = searchParams.get('repopulate');

      searchParams.delete('repopulate');

      if (service && !repopulate) {
         serviceAutosaver.save(form.getValues());
      }

      if (Object.keys(autosavedProduct).length > 0) {
         const urlWithoutParams = window.location.pathname;
         if (searchParams.toString()) {
            window.history.replaceState(
               null,
               '',
               `?${searchParams.toString()}`,
            );
         } else {
            window.history.replaceState(null, '', urlWithoutParams);
         }

         if (repopulate) {
            useAutosavedService();
         }
      }
   }, []);

   useEffect(() => {
      setHasChanges(hasFormChanged(watchedValues));
   }, [watchedValues]);

   useEffect(() => {
      setIsMounted(true);
   }, []);

   if (!isMounted) {
      return null;
   }

   let alertTitle,
      alertDescription,
      actionFn: () => void = onDelete;

   switch (actionContext) {
      case ActionContext.LEAVING:
         alertTitle = 'Changes not saved';
         alertDescription = 'Leaving will discard entered data.';
         actionFn = () => {
            serviceAutosaver.clearAll();
            router.back();
         };
         break;

      case ActionContext.DELETING:
         alertTitle = `Delete ${service?.name}?`;
         alertDescription = 'This action cannot be undone.';
         actionFn = onDelete;
         break;

      default:
         break;
   }

   const validateTimes = (startTime: string, endTime: string): boolean => {
      const startTimeComponents = startTime.split(' ');
      const endTimeComponents = endTime.split(' ');

      const startTimeHour = startTimeComponents[0].split(':')[0];
      const endTimeHour = endTimeComponents[0].split(':')[0];

      const startTimeMeridian = startTimeComponents[1];
      const endTimeMeridian = endTimeComponents[1];

      if (startTimeMeridian == 'pm' && endTimeMeridian == 'am') {
         return false;
      }

      if (startTimeMeridian == endTimeMeridian) {
         return parseInt(startTimeHour) % 12 < parseInt(endTimeHour) % 12;
      }

      return true;
   };

   const validateSelectedTimes = () => {
      const startTime = form.getValues().start_time;
      const endTime = form.getValues().end_time;
      if (startTime && endTime) {
         setIsValidAppointmentTime(validateTimes(startTime, endTime));
      }
   };

   const isMutating = updateMutation.isPending;

   return (
      <div className="space-y-6">
         <ActionModal
            isOpen={isAutosavedModalOpen}
            title="Unfinished service detected"
            description="You were previously adding a service. Do you want to continue editing it or start over?"
            declineText="Discard"
            onConfirm={() => useAutosavedService()}
            onClose={discardAutosavedService}
         />
         <AlertModal
            isOpen={open}
            onClose={() => {
               setOpen(false);
               setActionContext(ActionContext.NONE);
            }}
            onConfirm={actionFn}
            title={alertTitle}
            description={alertDescription}
            loading={loading}
         />

         <motion.div
            variants={mainContainerVariants}
            initial="hidden"
            animate="visible"
         >
            <Form {...form}>
               <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-8 w-full"
               >
                  <div className="grid gap-8">
                     <LoadingButton
                        isLoading={isMutating}
                        disabled={isMutating || !isValidAppointmentTime}
                        className="ml-auto"
                        type="submit"
                     >
                        {buttonText}
                     </LoadingButton>
                     <CardContainer>
                        <ServiceInfoCard
                           title="Service availability"
                           description="Start time is the earliest you can offer this service and end time is the latest."
                           className="flex flex-col"
                        >
                           <div className="flex gap-8">
                              <div className="w-[50%]">
                                 <FormField
                                    control={form.control}
                                    name="start_time"
                                    render={({ field }) => (
                                       <FormItem>
                                          <FormLabel>Start time</FormLabel>
                                          <Select
                                             disabled={isMutating}
                                             onValueChange={(value: string) => {
                                                field.onChange(value);
                                                validateSelectedTimes();
                                             }}
                                             value={`${field.value}`}
                                             defaultValue={`${field.value}`}
                                          >
                                             <FormControl>
                                                <SelectTrigger>
                                                   <SelectValue
                                                      placeholder="Select start time"
                                                      defaultValue={field.value}
                                                   />
                                                </SelectTrigger>
                                             </FormControl>
                                             <SelectContent>
                                                {hours.map((hour) => (
                                                   <SelectItem
                                                      key={hour.value}
                                                      value={`${hour.value}`}
                                                   >
                                                      {hour.label}
                                                   </SelectItem>
                                                ))}
                                             </SelectContent>
                                          </Select>
                                          <FormMessage />
                                       </FormItem>
                                    )}
                                 />
                              </div>
                              <div className="w-[50%]">
                                 <FormField
                                    control={form.control}
                                    name="end_time"
                                    render={({ field }) => (
                                       <FormItem>
                                          <FormLabel>End time</FormLabel>
                                          <FormControl>
                                             <Select
                                                disabled={isMutating}
                                                onValueChange={(
                                                   value: string,
                                                ) => {
                                                   field.onChange(value);
                                                   validateSelectedTimes();
                                                }}
                                                value={`${field.value}`}
                                                defaultValue={`${field.value}`}
                                             >
                                                <FormControl>
                                                   <SelectTrigger>
                                                      <SelectValue
                                                         defaultValue={
                                                            field.value
                                                         }
                                                         placeholder="Select end time"
                                                      />
                                                   </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                   {hours.map((hour) => (
                                                      <SelectItem
                                                         key={hour.value}
                                                         value={`${hour.value}`}
                                                      >
                                                         {hour.label}
                                                      </SelectItem>
                                                   ))}
                                                </SelectContent>
                                             </Select>
                                          </FormControl>
                                          <FormMessage />
                                       </FormItem>
                                    )}
                                 />
                              </div>
                           </div>
                           {!isValidAppointmentTime && (
                              <p className="text-xs text-destructive">
                                 Start time cannot be after end time
                              </p>
                           )}

                           <IntervalSwitches
                              interval={appointmentsInterval}
                              setInterval={setAppointmentsInterval}
                           />
                        </ServiceInfoCard>
                     </CardContainer>
                  </div>

                  <div className="flex flex-col gap-6 border rounded-lg p-6 pb-10">
                     <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                           <FormItem>
                              <FormLabel>Name</FormLabel>
                              <FormControl>
                                 <Input
                                    disabled={isMutating}
                                    placeholder="Service"
                                    {...field}
                                    onChange={(e) => {
                                       field.onChange(e);
                                       autosaveService();
                                    }}
                                 />
                              </FormControl>
                              <FormMessage />
                           </FormItem>
                        )}
                     />
                     <FormField
                        control={form.control}
                        name="price"
                        render={({ field }) => (
                           <FormItem>
                              <FormLabel>{`Price (${storeCurrency.toUpperCase()})`}</FormLabel>
                              <FormControl>
                                 <Input
                                    type="number"
                                    disabled={isMutating}
                                    placeholder="9.99"
                                    {...field}
                                    onChange={(e) => {
                                       field.onChange(e);
                                       autosaveService();
                                    }}
                                 />
                              </FormControl>
                              <FormMessage />
                           </FormItem>
                        )}
                     />
                  </div>

                  <FormField
                     control={form.control}
                     name="is_archived"
                     render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                           <FormControl>
                              <Checkbox
                                 checked={field.value}
                                 // @ts-ignore
                                 onCheckedChange={(e) => {
                                    field.onChange(e);
                                    autosaveService();
                                 }}
                              />
                           </FormControl>
                           <div className="space-y-1 leading-none">
                              <FormLabel>Archived</FormLabel>
                              <FormDescription>
                                 Hides this service from customers.
                              </FormDescription>
                           </div>
                        </FormItem>
                     )}
                  />
               </form>
            </Form>
         </motion.div>
      </div>
   );
};
