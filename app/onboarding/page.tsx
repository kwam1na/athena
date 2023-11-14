'use client';

import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { LoadingButton } from '@/components/ui/loading-button';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/use-toast';
import {
   apiCreateOrganization,
   apiUpdateOrganization,
} from '@/lib/api/organizations';
import { apiCreateStore } from '@/lib/api/stores';
import { apiUpdateUser } from '@/lib/api/users';
import { ServiceError } from '@/lib/error';
import { captureException } from '@sentry/nextjs';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useOnboarding } from '@/hooks/use-onboarding-state';
import { NameStep } from './steps/name-step';
import { OrganizationStep } from './steps/organization-step';
import { StoreStep } from './steps/store-step';
import { ConsoleLogger } from '@/lib/logger/console-logger';
import { useWrappedUser } from '@/providers/wrapped-user-provider';
import { createBrowserClient } from '@supabase/ssr';
import { User } from '@supabase/supabase-js';

interface OnboardingStep {
   title: string;
   component: React.FC;
   action: () => void;
}

export default function Onboarding() {
   const [isSubmitting, setIsSubmitting] = useState(false);
   const [isRedirecting, setIsRedirecting] = useState(false);
   const [user, setUser] = useState<User | undefined>(undefined);
   const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
   );

   const logger = new ConsoleLogger();

   const {
      currentStep,
      handleNext,
      handleBack,
      handleEnteredName,
      handleOrgNameChange,
      handleUseSuggestedToggle,
      handleStoreNameChange,
      handleCurrencyChange,
      toggleInvalidInput,
      ...state
   } = useOnboarding();

   useEffect(() => {
      const getUser = async () => {
         const {
            data: { session },
         } = await supabase.auth.getSession();
         const user = session?.user;
         setUser(user);
      };

      getUser();
   }, []);

   const { toast } = useToast();

   const saveName = async () => {
      if (!state.name.trim()) {
         toggleInvalidInput('name', true);
         return;
      }

      try {
         setIsSubmitting(true);
         await apiUpdateUser({ name: state.name });
         handleNext();
      } catch (error) {
         captureException(error);

         logger.error('action:saveName', {
            name: state.name,
            user_id: user?.id,
            component: 'onboarding',
            error: (error as Error).message,
         });

         const serviceError = error as ServiceError;
         let message = serviceError.message;
         if (serviceError.status === 401) {
            message = 'Session timed out. Please sign in again.';
         }

         toast({
            title: message,
         });

         if (serviceError.status === 401) {
            setTimeout(() => {
               window.location.href = '/auth';
            }, 2000);
         }
      } finally {
         logger.info('action:saveName', {
            name: state.name,
            user_id: user?.id,
            component: 'onboarding',
         });
         setIsSubmitting(false);
      }
   };

   const saveOrganizationName = async () => {
      if (!state.organizationName.trim()) {
         toggleInvalidInput('orgName', true);
         return;
      }

      try {
         setIsSubmitting(true);
         const storedOrgId = sessionStorage.getItem('organizationId');

         if (storedOrgId) {
            await apiUpdateOrganization(storedOrgId, {
               name: state.organizationName,
               organization_id: parseInt(storedOrgId),
            });
         } else {
            const newOrg = await apiCreateOrganization({
               name: state.organizationName,
            });
            sessionStorage.setItem('organizationId', newOrg.id);
         }

         handleNext();
      } catch (error) {
         captureException(error);
         logger.error('action:saveOrganizationName', {
            store_name: state.storeName,
            user_id: user?.id,
            component: 'onboarding',
            error: (error as Error).message,
         });
         toast({
            title: (error as any).message,
         });
      } finally {
         logger.info('action:saveOrganizationName', {
            organization_name: state.organizationName,
            organization_id: sessionStorage.getItem('organizationId'),
            user_id: user?.id,
            component: 'onboarding',
         });
         setIsSubmitting(false);
      }
   };

   const saveStoreName = async () => {
      if (!state.storeName.trim()) {
         toggleInvalidInput('storeName', true);
         return;
      }

      if (state.currency === '') {
         toast({
            title: 'Please select a currency',
         });
         return;
      }

      const storedOrgId = sessionStorage.getItem('organizationId');

      try {
         setIsSubmitting(true);
         const response = await apiCreateStore({
            name: state.storeName,
            currency: state.currency,
            organization_id: storedOrgId,
         });

         await apiUpdateUser({ is_onboarded: true });
         sessionStorage.removeItem('organizationId');
         setIsRedirecting(true);
         window.location.assign(
            `/organizations/${storedOrgId}/store/${response.id}`,
         );
      } catch (error) {
         captureException(error);
         logger.error('action:saveStoreName', {
            store_name: state.storeName,
            user_id: user?.id,
            component: 'onboarding',
            error: (error as Error).message,
         });
         toast({
            title: (error as any).message,
         });
      } finally {
         logger.info('action:saveStoreName', {
            store_name: state.storeName,
            user_id: user?.id,
            component: 'onboarding',
         });
         setIsSubmitting(false);
      }
   };

   const Buttons = ({ onProceed }: { onProceed: () => void }) => {
      return (
         <div className="mr-auto space-x-4">
            {currentStep > 0 && (
               <Button
                  variant={'outline'}
                  disabled={isSubmitting || isRedirecting}
                  onClick={() => handleBack()}
               >
                  <ArrowLeft className="h-4 w-4" />
               </Button>
            )}
            <LoadingButton
               variant={'outline'}
               isLoading={isSubmitting}
               disabled={isSubmitting || isRedirecting}
               onClick={() => {
                  onProceed();
               }}
            >
               <ArrowRight className="h-4 w-4" />
            </LoadingButton>
         </div>
      );
   };

   const steps = [
      {
         title: 'Name',
         component: (
            <NameStep
               name={state.name}
               isInvalidName={state.isInvalidName}
               onNameChange={handleEnteredName}
            />
         ),
         onProceed: saveName,
         blurb: (
            <p className="text-3xl leading-relaxed self-center my-auto">
               Knowing your name helps us personalize your experience. What
               should we call you?
            </p>
         ),
      },
      {
         title: 'Organization',
         component: (
            <OrganizationStep
               organizationName={state.organizationName}
               useSuggestedOrgName={state.useSuggestedOrgName}
               isInvalidOrganizationName={state.isInvalidOrganizationName}
               onOrgNameChange={handleOrgNameChange}
               onUseSuggestedToggle={handleUseSuggestedToggle}
               suggestedOrgName={state.suggestedOrgName}
            />
         ),
         onProceed: saveOrganizationName,
         blurb: (
            <p className="text-3xl leading-relaxed self-center my-auto">
               Think of your organization as your brand's main identity. It
               could be your company name, a holding entity, or a larger group.
               Choose a name that represents the umbrella for all your business
               activities. (You can update this later.)
            </p>
         ),
      },
      {
         title: 'Store',
         component: (
            <StoreStep
               storeName={state.storeName}
               isInvalidStoreName={state.isInvalidStoreName}
               currency={state.currency}
               onStoreNameChange={handleStoreNameChange}
               onCurrencyChange={handleCurrencyChange}
               currencies={state.currencies}
               disabled={isSubmitting || isRedirecting}
            />
         ),
         onProceed: saveStoreName,
         blurb: (
            <p className="text-3xl leading-relaxed self-center my-auto">
               Stores are the individual marketplaces where your products meet
               your customers. They sit under the organization's umbrella, each
               with its unique brand and identity, yet unified by your
               overarching business strategy.
            </p>
         ),
      },
   ];

   const containerVariants = {
      hidden: {
         opacity: 0,
         y: 16,
      },
      visible: {
         opacity: 1,
         y: 0,
         transition: {
            type: 'easeIn',
            duration: 0.8,
         },
      },
   };

   const buttonVariants = {
      hidden: {
         opacity: 0,
         x: -24,
      },
      visible: {
         opacity: 1,
         x: 0,
         transition: {
            type: 'easeIn',
            duration: 0.5,
            delay: 0.9,
         },
      },
   };

   const blurbVariants = {
      hidden: {
         opacity: 0,
         y: 8,
      },
      visible: {
         opacity: 1,
         y: 0,
         transition: {
            type: 'easeIn',
            duration: 0.7,
            delay: 0.9,
         },
      },
   };

   return (
      <div className="flex h-full">
         <div className="flex flex-col h-full w-[50%] justify-center gap-8 px-16">
            <motion.div
               variants={containerVariants}
               key={`container-${currentStep}`}
               initial="hidden"
               animate="visible"
               className="space-y-8"
            >
               {steps[currentStep].component}
            </motion.div>
            <motion.div
               variants={buttonVariants}
               key={`button-${currentStep}`}
               initial="hidden"
               animate="visible"
            >
               <Buttons onProceed={steps[currentStep].onProceed} />
            </motion.div>
         </div>

         <div className="flex w-[50%] p-32 bg-card">
            <motion.div
               className="flex flex-col justify-between w-full h-full"
               variants={blurbVariants}
               key={`blurb-${currentStep}`}
               initial="hidden"
               animate="visible"
            >
               {steps[currentStep].blurb}
               <div className="flex flex-col gap-4 w-full">
                  <Progress
                     className="bg-background"
                     value={((currentStep + 1) / state.TOTAL_STEPS) * 100}
                  />
                  <p className="text-muted-foreground text-sm ml-auto">
                     {`Step ${currentStep + 1} of ${state.TOTAL_STEPS}`}
                  </p>
               </div>
            </motion.div>
         </div>
      </div>
   );
}
