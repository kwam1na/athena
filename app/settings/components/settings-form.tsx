'use client';

import * as z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { store } from '@prisma/client';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { captureException } from '@sentry/nextjs';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
   Form,
   FormControl,
   FormField,
   FormItem,
   FormLabel,
   FormMessage,
} from '@/components/ui/form';
import { Separator } from '@/components/ui/separator';
import { Heading } from '@/components/ui/heading';
import { AlertModal } from '@/components/modals/alert-modal';
import { useOrigin } from '@/hooks/use-origin';
import { ActionAlert } from '@/components/ui/action-alert';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import { currencies, hours } from '@/lib/constants';
import { useToast } from '@/components/ui/use-toast';
import { revalidatePath } from 'next/cache';
import { useStoreCurrency } from '@/providers/currency-provider';
import { LoadingButton } from '@/components/ui/loading-button';
import { apiDeleteStore, apiUpdateStore } from '@/lib/api/stores';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { CheckCircle2, CheckIcon, Clock, Info, MapPin } from 'lucide-react';
import { Store } from '@/lib/types';
import { InfoLine } from '@/components/info-line';

const formSchema = z.object({
   name: z.string().min(2),
   currency: z.string().min(3),
   phone_number: z
      .string()
      .regex(/^\+?[0-9]\d{1,14}$/, 'Invalid phone number')
      .optional(),
   low_stock_threshold: z.coerce.number().min(0),
   street_address: z.string().min(1),
   city: z.string().min(1),
   country: z.string().min(1),
});

type SettingsFormValues = z.infer<typeof formSchema>;

interface SettingsFormProps {
   store: Store | null;
}

type BusinessHour = {
   day: string;
   open_time: string | null;
   close_time: string | null;
   is_closed: boolean;
};

type BusinessHours = Record<string, BusinessHour>;

const Day = ({
   day,
   isClosed,
   isInvalidSelection,
   hours,
   onClosedToggleSwitch,
   onSelectBusinessHour,
   disabled,
}: {
   day: string;
   isClosed: boolean;
   isInvalidSelection?: boolean;
   hours?: BusinessHour;
   onClosedToggleSwitch: (checked: boolean, day: string) => void;
   onSelectBusinessHour: (
      day: string,
      time: string,
      type: 'open' | 'close',
   ) => void;
   disabled?: boolean;
}) => {
   return (
      <div className="p-4 border space-y-2 rounded shadow-sm">
         <div className="flex justify-between items-center mb-4">
            <p className="text-sm">{day}</p>
            <div className="flex items-center gap-4">
               <Switch
                  id={`toggle-${day}`}
                  checked={isClosed}
                  onCheckedChange={(checked) =>
                     onClosedToggleSwitch(checked, day)
                  }
               />
               <Label className="text-sm" htmlFor={`toggle-${day}`}>
                  {isClosed ? 'Closed' : 'Open'}
               </Label>
            </div>
         </div>
         <div className="flex gap-4">
            <BusinessHourInput
               onChange={onSelectBusinessHour}
               day={day}
               type="open"
               disabled={disabled}
               value={hours?.open_time}
            />
            <BusinessHourInput
               onChange={onSelectBusinessHour}
               day={day}
               type="close"
               disabled={disabled}
               value={hours?.close_time}
            />
         </div>
         {isInvalidSelection && (
            <p className="text-xs text-destructive">
               Opening hour cannot be after closing hour
            </p>
         )}
      </div>
   );
};

const BusinessHourInput = ({
   day,
   disabled,
   onChange,
   type,
   value,
}: {
   day: string;
   disabled?: boolean;
   onChange: (day: string, time: string, type: 'open' | 'close') => void;
   type: 'open' | 'close';
   value?: string | null;
}) => {
   return (
      <div className="flex flex-col gap-2 w-[160px]">
         <Select
            disabled={disabled}
            defaultValue={value ? value : undefined}
            onValueChange={(value: string) => {
               onChange(day, value, type);
            }}
         >
            <SelectTrigger>
               <SelectValue />
            </SelectTrigger>
            <SelectContent>
               {hours.map((hour) => (
                  <SelectItem key={hour.value} value={`${hour.value}`}>
                     {hour.label}
                  </SelectItem>
               ))}
            </SelectContent>
         </Select>
      </div>
   );
};

const HourOfOperation = ({
   day,
   disabled,
   hours,
   isClosed,
   onClosedToggleSwitch,
   onInvalidHours,
   onSelectBusinessHour,
}: {
   day: string;
   disabled?: boolean;
   hours?: BusinessHour;
   isClosed: boolean;
   onClosedToggleSwitch: (checked: boolean, day: string) => void;
   onInvalidHours: (isInvalid: boolean) => void;
   onSelectBusinessHour: (
      day: string,
      time: string,
      type: 'open' | 'close',
   ) => void;
}) => {
   const [isInvalidSelection, setIsInvalidSelection] = useState(false);

   const handleSelectBusinessHour = (
      day: string,
      time: string,
      type: 'open' | 'close',
   ) => {
      const newHours = { ...hours };

      if (type === 'open') {
         newHours.open_time = time;
      } else {
         newHours.close_time = time;
      }

      const isValid = validateTimes(
         newHours.open_time || '',
         newHours.close_time || '',
      );

      setIsInvalidSelection(!isValid);
      onSelectBusinessHour(day, time, type);
      onInvalidHours(isValid);
   };

   return (
      <Day
         day={day}
         isClosed={isClosed}
         hours={hours}
         onClosedToggleSwitch={onClosedToggleSwitch}
         onSelectBusinessHour={handleSelectBusinessHour}
         disabled={disabled}
         isInvalidSelection={isInvalidSelection}
      />
   );
};

const BusinessHourRow = ({ children }: { children: React.ReactNode }) => {
   return <div className="flex gap-8">{children}</div>;
};

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

export const SettingsForm: React.FC<SettingsFormProps> = ({ store }) => {
   const router = useRouter();

   const [open, setOpen] = useState(false);
   const [loading, setLoading] = useState(false);
   const { setStoreCurrency } = useStoreCurrency();

   const [invalidDays, setInvalidDays] = useState<Record<string, boolean>>({});

   const transformedHours = (
      store?.store_hours as Record<string, any>[]
   )?.reduce(
      (acc: BusinessHours, { day, is_closed, open_time, close_time }) => {
         acc[day] = {
            day,
            open_time,
            close_time,
            is_closed,
         };
         return acc;
      },
      {},
   );

   const hasStoreHours =
      transformedHours && Object.keys(transformedHours).length > 0;

   const [businessHours, setBusinessHours] = useState<BusinessHours>(
      hasStoreHours
         ? transformedHours
         : {
              Mon: {
                 day: 'Mon',
                 open_time: '9:00 am',
                 close_time: '7:00 pm',
                 is_closed: false,
              },
              Tue: {
                 day: 'Tue',
                 open_time: '9:00 am',
                 close_time: '7:00 pm',
                 is_closed: false,
              },
              Wed: {
                 day: 'Wed',
                 open_time: '9:00 am',
                 close_time: '7:00 pm',
                 is_closed: false,
              },
              Thu: {
                 day: 'Thu',
                 open_time: '9:00 am',
                 close_time: '7:00 pm',
                 is_closed: false,
              },
              Fri: {
                 day: 'Fri',
                 open_time: '9:00 am',
                 close_time: '7:00 pm',
                 is_closed: false,
              },
              Sat: {
                 day: 'Sat',
                 open_time: '9:00 am',
                 close_time: '7:00 pm',
                 is_closed: false,
              },
              Sun: {
                 day: 'Sun',
                 open_time: '11:00 am',
                 close_time: '7:00 pm',
                 is_closed: true,
              },
           },
   );

   const handleInvalidHours = (day: string, isValid: boolean) => {
      setInvalidDays((prev) => ({ ...prev, [day]: !isValid }));
   };

   const getInitialFormValues = (data: any) => {
      if (!data) return { name: '', currency: '', low_stock_threshold: 0 };

      const { settings, store_location, ...rest } = data;
      const low_stock_threshold =
         settings &&
         typeof settings === 'object' &&
         'low_stock_threshold' in settings
            ? settings.low_stock_threshold
            : 0;

      return {
         ...rest,
         currency: data.currency,
         low_stock_threshold,
         street_address: store_location?.street_address,
         city: store_location?.city,
         country: store_location?.country,
         phone_number: store?.store_phone_number,
      };
   };

   const form = useForm<SettingsFormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: getInitialFormValues(store),
   });

   const hasInvalidDays = Object.values(invalidDays).some(
      (isInvalid) => isInvalid,
   );

   const onSubmit = async (data: SettingsFormValues) => {
      const storeHours = Object.values(businessHours).map((hour) => ({
         ...hour,
      }));

      const storeLocation = {
         street_address: data.street_address,
         city: data.city,
         country: data.country,
      };

      const body = {
         ...data,
         store_hours: storeHours,
         store_location: storeLocation,
         store_phone_number: data.phone_number,
      };

      try {
         setLoading(true);
         await apiUpdateStore('1', body);
         router.refresh();
         setStoreCurrency(data.currency);
         toast('Store updated', { icon: <CheckCircle2 className="w-4 h-4" /> });
      } catch (error: any) {
         captureException(error);
         toast('Something went wrong. Try again.');
      } finally {
         setLoading(false);
      }
   };

   const onDelete = async () => {
      try {
         setLoading(true);
         await apiDeleteStore('1');
         router.refresh();
         router.push('/');
         toast('Store deleted.');
      } catch (error: any) {
         captureException(error);
         toast(
            'Make sure you removed all products and categories first and then try again.',
         );
      } finally {
         setLoading(false);
         setOpen(false);
      }
   };

   const updateBusinessHour = (
      day: string,
      time: string,
      type: 'open' | 'close',
   ) => {
      setBusinessHours((prev) => ({
         ...prev,
         [day]: {
            ...prev[day],
            open_time: type == 'open' ? time : prev[day].open_time,
            close_time: type == 'close' ? time : prev[day].close_time,
         },
      }));
   };

   const handleBusinessHourToggleSwitch = (checked: boolean, day: string) => {
      setBusinessHours((prev) => ({
         ...prev,
         [day]: {
            ...prev[day],
            is_closed: checked,
         },
      }));
   };

   const isShopClosedOnDay = (day: string) => {
      return businessHours[day].is_closed;
   };

   return (
      <>
         <AlertModal
            isOpen={open}
            onClose={() => setOpen(false)}
            onConfirm={onDelete}
            loading={loading}
         />
         <Form {...form}>
            <form
               onSubmit={form.handleSubmit(onSubmit)}
               className="space-y-4 w-full"
            >
               <div className="flex justify-end w-full">
                  <LoadingButton
                     isLoading={loading}
                     disabled={loading || hasInvalidDays}
                     className="ml-auto w-[116px]"
                     type="submit"
                     variant={'outline'}
                  >
                     {!loading && <CheckCircle2 className="w-4 h-4 mr-2" />}
                     {loading ? 'Saving' : 'Save'}
                  </LoadingButton>
               </div>
               <div className="space-y-4 border rounded-lg p-6">
                  <InfoLine
                     icon={<Info className="w-4 h-4 text-muted-foreground" />}
                     text="Details"
                     isMuted
                     isBold
                  />
                  <div className="md:grid md:grid-cols-3 gap-8">
                     <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                           <FormItem>
                              <FormLabel>Name</FormLabel>
                              <FormControl>
                                 <Input
                                    disabled={loading}
                                    placeholder="Store name"
                                    {...field}
                                 />
                              </FormControl>
                              <FormMessage />
                           </FormItem>
                        )}
                     />

                     <FormField
                        control={form.control}
                        name="currency"
                        render={({ field }) => (
                           <FormItem>
                              <FormLabel>Currency</FormLabel>
                              <Select
                                 disabled={loading}
                                 onValueChange={field.onChange}
                                 value={field.value}
                                 defaultValue={field.value}
                              >
                                 <FormControl>
                                    <SelectTrigger>
                                       <SelectValue
                                          defaultValue={field.value}
                                          placeholder="Select a currency"
                                       />
                                    </SelectTrigger>
                                 </FormControl>
                                 <SelectContent>
                                    {currencies.map((currency) => (
                                       <SelectItem
                                          key={currency.value}
                                          value={currency.value}
                                       >
                                          {currency.label}
                                       </SelectItem>
                                    ))}
                                 </SelectContent>
                              </Select>
                              <FormMessage />
                           </FormItem>
                        )}
                     />

                     <FormField
                        control={form.control}
                        name="phone_number"
                        render={({ field }) => (
                           <FormItem>
                              <FormLabel>Phone number</FormLabel>
                              <FormControl>
                                 <Input
                                    disabled={loading}
                                    placeholder="Store phone"
                                    {...field}
                                 />
                              </FormControl>
                              <FormMessage />
                           </FormItem>
                        )}
                     />
                  </div>
               </div>

               <div className="space-y-4 border rounded-lg p-6">
                  <InfoLine
                     icon={<MapPin className="w-4 h-4 text-muted-foreground" />}
                     text="Location"
                     isMuted
                     isBold
                  />
                  <div className="md:grid md:grid-cols-3 gap-8">
                     <FormField
                        control={form.control}
                        name="street_address"
                        render={({ field }) => (
                           <FormItem>
                              <FormLabel>Street address</FormLabel>
                              <FormControl>
                                 <Input
                                    disabled={loading}
                                    placeholder="123 St."
                                    {...field}
                                 />
                              </FormControl>
                              <FormMessage />
                           </FormItem>
                        )}
                     />

                     <FormField
                        control={form.control}
                        name="city"
                        render={({ field }) => (
                           <FormItem>
                              <FormLabel>City</FormLabel>
                              <FormControl>
                                 <Input
                                    disabled={loading}
                                    placeholder="Central city"
                                    {...field}
                                 />
                              </FormControl>
                              <FormMessage />
                           </FormItem>
                        )}
                     />

                     <FormField
                        control={form.control}
                        name="country"
                        render={({ field }) => (
                           <FormItem>
                              <FormLabel>Country</FormLabel>
                              <FormControl>
                                 <Input
                                    disabled={loading}
                                    placeholder="Ghana"
                                    {...field}
                                 />
                              </FormControl>
                              <FormMessage />
                           </FormItem>
                        )}
                     />
                  </div>
               </div>

               <div className="space-y-4 border rounded-lg p-6">
                  <InfoLine
                     icon={<Clock className="w-4 h-4 text-muted-foreground" />}
                     text="Business hours"
                     isMuted
                     isBold
                  />
                  <BusinessHourRow>
                     <HourOfOperation
                        day="Mon"
                        isClosed={isShopClosedOnDay('Mon')}
                        disabled={loading || isShopClosedOnDay('Mon')}
                        onClosedToggleSwitch={handleBusinessHourToggleSwitch}
                        onSelectBusinessHour={updateBusinessHour}
                        hours={businessHours['Mon']}
                        onInvalidHours={(isValid) =>
                           handleInvalidHours('Mon', isValid)
                        }
                     />

                     <HourOfOperation
                        day="Tue"
                        isClosed={isShopClosedOnDay('Tue')}
                        disabled={loading || isShopClosedOnDay('Tue')}
                        onClosedToggleSwitch={handleBusinessHourToggleSwitch}
                        onSelectBusinessHour={updateBusinessHour}
                        hours={businessHours['Tue']}
                        onInvalidHours={(isValid) =>
                           handleInvalidHours('Tue', isValid)
                        }
                     />

                     <HourOfOperation
                        day="Wed"
                        isClosed={isShopClosedOnDay('Wed')}
                        disabled={loading || isShopClosedOnDay('Wed')}
                        onClosedToggleSwitch={handleBusinessHourToggleSwitch}
                        onSelectBusinessHour={updateBusinessHour}
                        hours={businessHours['Wed']}
                        onInvalidHours={(isValid) =>
                           handleInvalidHours('Wed', isValid)
                        }
                     />
                  </BusinessHourRow>

                  <BusinessHourRow>
                     <HourOfOperation
                        day="Thu"
                        isClosed={isShopClosedOnDay('Thu')}
                        disabled={loading || isShopClosedOnDay('Thu')}
                        onClosedToggleSwitch={handleBusinessHourToggleSwitch}
                        onSelectBusinessHour={updateBusinessHour}
                        hours={businessHours['Thu']}
                        onInvalidHours={(isValid) =>
                           handleInvalidHours('Thu', isValid)
                        }
                     />
                     <HourOfOperation
                        day="Fri"
                        isClosed={isShopClosedOnDay('Fri')}
                        disabled={loading || isShopClosedOnDay('Fri')}
                        onClosedToggleSwitch={handleBusinessHourToggleSwitch}
                        onSelectBusinessHour={updateBusinessHour}
                        hours={businessHours['Fri']}
                        onInvalidHours={(isValid) =>
                           handleInvalidHours('Fri', isValid)
                        }
                     />
                     <HourOfOperation
                        day="Sat"
                        isClosed={isShopClosedOnDay('Sat')}
                        disabled={loading || isShopClosedOnDay('Sat')}
                        onClosedToggleSwitch={handleBusinessHourToggleSwitch}
                        onSelectBusinessHour={updateBusinessHour}
                        hours={businessHours['Sat']}
                        onInvalidHours={(isValid) =>
                           handleInvalidHours('Sat', isValid)
                        }
                     />
                  </BusinessHourRow>

                  <BusinessHourRow>
                     <HourOfOperation
                        day="Sun"
                        isClosed={isShopClosedOnDay('Sun')}
                        disabled={loading || isShopClosedOnDay('Sun')}
                        onClosedToggleSwitch={handleBusinessHourToggleSwitch}
                        onSelectBusinessHour={updateBusinessHour}
                        hours={businessHours['Sun']}
                        onInvalidHours={(isValid) =>
                           handleInvalidHours('Sun', isValid)
                        }
                     />
                  </BusinessHourRow>
               </div>
            </form>
         </Form>
         {/* <Separator />
         <ActionAlert
            title={'Delete this store'}
            description={'This will delete this store and all associated data.'}
            variant={'danger'}
            buttonText={'Delete'}
            onClick={() => setOpen(true)}
         /> */}
      </>
   );
};
