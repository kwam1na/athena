'use client';

import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { LoadingButton } from '@/components/ui/loading-button';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/use-toast';
import {
   apiCreateOrganization,
   apiGetOrganizationMemberStatus,
   apiUpdateOrganization,
   apiUpdateOrganizationMember,
} from '@/lib/api/organizations';
import { apiCreateStore } from '@/lib/api/stores';
import { apiUpdateUser } from '@/lib/api/users';
import { ServiceError } from '@/lib/error';
import { captureException } from '@sentry/nextjs';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useOnboarding } from '@/hooks/use-onboarding-state';
import { NameStep } from './steps/name-step';
import { OrganizationStep } from './steps/organization-step';
import { StoreStep } from './steps/store-step';
import { postLog } from '@/lib/api/logger';
import { useRouter } from 'next/navigation';
import {
   onboardingBlurbVariants,
   onboardingButtonVariants,
   onboardingContainerVariants,
} from '@/lib/animation/constants';
import { useOnboardingData } from '@/providers/onboarding-data-provider';
import { useUser } from '@/providers/user-provider';
import { Loader } from '@/components/ui/loader';

export default function Onboarding() {
   const [isSubmitting, setIsSubmitting] = useState(false);
   const [isRedirecting, setIsRedirecting] = useState(false);
   const [isOrganizationMember, setIsOrganizationMember] = useState(false);
   const [
      isFetchingOrganizationMemberStatus,
      setIsFetchingOrganizationMemberStatus,
   ] = useState(false);
   const router = useRouter();
   const { setOrganizationId, setStoreId } = useOnboardingData();
   const { user, isLoading: isLoadingUser } = useUser();

   const {
      currentStep,
      handleNext,
      handleBack,
      handleEnteredName,
      handleOrgNameChange,
      handleUseSuggestedToggle,
      handleStoreNameChange,
      handleCurrencyChange,
      handleEnteredLowStockThreshold,
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
         await postLog('info', 'action: saveName', {
            name: state.name,
            component: 'onboarding',
         });

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
               router.replace('/auth');
            }, 2000);
         }
      } finally {
         setIsSubmitting(false);
      }
   };

   const saveNameAndProceedToComplete = async () => {
      if (!state.name.trim()) {
         toggleInvalidInput('name', true);
         return;
      }

      const storedOrgId = sessionStorage.getItem('organizationId');

      setIsSubmitting(true);
      const results = await Promise.allSettled([
         apiUpdateUser({
            name: state.name,
            organization_id: storedOrgId ? parseInt(storedOrgId) : undefined,
            is_onboarded: true,
         }),
         apiUpdateOrganizationMember({
            email: user?.email,
            user_name: state.name,
            is_onboarded: true,
            user_id: user?.id,
         }),
      ]);

      // Process the results
      const hasError = results.some((result) => result.status === 'rejected');
      if (hasError) {
         results.forEach((result) => {
            if (result.status === 'rejected') {
               console.error('Promise rejected:', result.reason);
               // Handle each error accordingly
               captureException(result.reason);

               const serviceError = result.reason as ServiceError;
               let message = serviceError.message;
               if (serviceError.status === 401) {
                  message = 'Session timed out. Please sign in again.';
                  toast({ title: message });
                  setTimeout(() => {
                     router.replace('/auth');
                  }, 2000);
               } else {
                  // For other errors, you might want to show a toast message or similar
                  toast({ title: message });
               }
            }
         });
      } else {
         // If there are no errors, proceed to the complete page
         router.replace('/onboarding/complete');
      }

      setIsSubmitting(false);
   };

   const saveOrganizationName = async () => {
      if (!state.organizationName.trim()) {
         toggleInvalidInput('orgName', true);
         return;
      }

      try {
         await postLog('info', 'action: began saveOrganizationName', {
            organization_name: state.organizationName,
            organization_id: sessionStorage.getItem('organizationId'),
            component: 'onboarding',
         });
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
            setOrganizationId(newOrg.id);
         }

         await postLog('info', 'action: saveOrganizationName', {
            organization_name: state.organizationName,
            organization_id: sessionStorage.getItem('organizationId'),
            component: 'onboarding',
         });

         handleNext();
      } catch (error) {
         captureException(error);

         await postLog('error', 'action: saveOrganizationName', {
            store_name: state.storeName,
            component: 'onboarding',
            error: (error as Error).message,
         });

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

      if (!state.lowStockThreshold) {
         toggleInvalidInput('lowStockThreshold', true);
         return;
      }

      const storedOrgId = sessionStorage.getItem('organizationId');

      try {
         await postLog('info', 'action: began saveStoreName', {
            store_name: state.storeName,
            component: 'onboarding',
         });
         setIsSubmitting(true);
         const response = await apiCreateStore({
            name: state.storeName,
            currency: state.currency,
            organization_id: storedOrgId,
            low_stock_threshold: state.lowStockThreshold,
         });

         await apiUpdateUser({ is_onboarded: true });
         await postLog('info', 'action: saveStoreName', {
            store_name: state.storeName,
            component: 'onboarding',
         });
         sessionStorage.removeItem('organizationId');
         setIsRedirecting(true);
         setStoreId(response.id);
         router.replace(`/onboarding/success`);
      } catch (error) {
         captureException(error);

         await postLog('error', 'action: saveStoreName', {
            store_name: state.storeName,
            component: 'onboarding',
            error: (error as Error).message,
         });

         toast({
            title: (error as any).message,
         });
      } finally {
         setIsSubmitting(false);
      }
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
               Consider your organization as your brand's primary identity, such
               as your company name or holding group. Select a name that
               encompasses all your business operations. (You can change it
               later.)
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
               lowStockThreshold={state.lowStockThreshold}
               isInvalidLowStockThreshold={state.isInvalidLowStockThreshold}
               onStoreNameChange={handleStoreNameChange}
               onCurrencyChange={handleCurrencyChange}
               onLowStockThresholdChange={handleEnteredLowStockThreshold}
               currencies={state.currencies}
               disabled={isSubmitting || isRedirecting}
            />
         ),
         onProceed: saveStoreName,
         blurb: (
            <p className="text-3xl leading-relaxed self-center my-auto">
               Stores are distinct marketplaces under your organization where
               products connect with customers, each with its own brand yet
               aligned with your overall business strategy.
            </p>
         ),
      },
   ];

   const addedMemberSteps = [
      {
         title: 'Name',
         component: (
            <NameStep
               name={state.name}
               isInvalidName={state.isInvalidName}
               onNameChange={handleEnteredName}
            />
         ),
         onProceed: saveNameAndProceedToComplete,
         blurb: (
            <p className="text-3xl leading-relaxed self-center my-auto">
               Knowing your name helps us personalize your experience. What
               should we call you?
            </p>
         ),
      },
   ];

   const onboardingSteps = isOrganizationMember ? addedMemberSteps : steps;

   useEffect(() => {
      const checkMembershipStatus = async () => {
         setIsFetchingOrganizationMemberStatus(true);
         try {
            if (user?.email) {
               const response = await apiGetOrganizationMemberStatus(
                  user.email,
               );
               const { exists, organization_name, organization_id } = response;
               if (exists) {
                  setIsOrganizationMember(true);
                  sessionStorage.setItem('organizationName', organization_name);
                  sessionStorage.setItem('organizationId', organization_id);
               }
            }
         } catch (error) {
            // Handle any errors
         } finally {
            setIsFetchingOrganizationMemberStatus(false);
         }
      };

      checkMembershipStatus();
   }, [user?.email]);

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

   return (
      <div className="flex h-full">
         {(isLoadingUser || isFetchingOrganizationMemberStatus) && <Loader />}
         {!isLoadingUser && !isFetchingOrganizationMemberStatus && (
            <>
               <div className="flex flex-col h-full w-[50%] justify-center gap-8 px-16">
                  <motion.div
                     variants={onboardingContainerVariants}
                     key={`container-${currentStep}`}
                     initial="hidden"
                     animate="visible"
                     className="space-y-8"
                  >
                     {onboardingSteps[currentStep]?.component}
                  </motion.div>
                  <motion.div
                     variants={onboardingButtonVariants}
                     key={`button-${currentStep}`}
                     initial="hidden"
                     animate="visible"
                  >
                     <Buttons
                        onProceed={onboardingSteps[currentStep]?.onProceed}
                     />
                  </motion.div>
               </div>

               <div className="flex w-[50%] p-32 bg-card">
                  <motion.div
                     className="flex flex-col justify-between w-full h-full"
                     variants={onboardingBlurbVariants}
                     key={`blurb-${currentStep}`}
                     initial="hidden"
                     animate="visible"
                  >
                     {onboardingSteps[currentStep]?.blurb}
                     {onboardingSteps.length > 1 && (
                        <div className="flex flex-col gap-4 w-full">
                           <Progress
                              className="bg-background"
                              value={
                                 ((currentStep + 1) / state.TOTAL_STEPS) * 100
                              }
                           />
                           <p className="text-muted-foreground text-sm ml-auto">
                              {`Step ${currentStep + 1} of ${
                                 state.TOTAL_STEPS
                              }`}
                           </p>
                        </div>
                     )}
                  </motion.div>
               </div>
            </>
         )}
      </div>
   );
}
