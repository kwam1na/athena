'use client';

import usePageLoading from 'next/app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingButton } from '@/components/ui/loading-button';
import { Progress } from '@/components/ui/progress';
import {
   SelectTrigger,
   Select,
   SelectValue,
   SelectContent,
   SelectItem,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import {
   apiCreateOrganization,
   apiUpdateOrganization,
} from '@/lib/api/organizations';
import { apiCreateStore } from '@/lib/api/stores';
import { apiUpdateUser } from '@/lib/api/users';
import { currencies } from '@/lib/constants';
import { ServiceError } from '@/lib/error';
import { captureException } from '@sentry/nextjs';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { ChangeEvent, useEffect, useState } from 'react';
import { set } from 'date-fns';
import { useOnboarding } from '@/hooks/use-onboarding-state';
import { NameStep } from './steps/name-step';
import { OrganizationStep } from './steps/organization-step';
import { StoreStep } from './steps/store-step';

interface OnboardingStep {
   title: string;
   component: React.FC;
   action: () => void;
}

export default function Onboarding() {
   const [isSubmitting, setIsSubmitting] = useState(false);
   const [isRedirecting, setIsRedirecting] = useState(false);

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
         toast({
            title: (error as any).message,
         });
      } finally {
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
         toast({
            title: (error as any).message,
         });
      } finally {
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
      },
   ];

   return (
      <div className="flex h-full">
         <div className="flex flex-col h-full w-[50%] justify-center gap-8 px-16">
            {steps[currentStep].component}
            <Buttons onProceed={steps[currentStep].onProceed} />
         </div>

         <div className="flex w-[50%] items-end p-32 bg-card h-full">
            <div className="flex flex-col gap-4 w-full">
               <Progress
                  className="bg-background"
                  value={((currentStep + 1) / state.TOTAL_STEPS) * 100}
               />
               <p className="text-muted-foreground text-sm ml-auto">
                  {`Step ${currentStep + 1} of ${state.TOTAL_STEPS}`}
               </p>
            </div>
         </div>
      </div>
   );
}
