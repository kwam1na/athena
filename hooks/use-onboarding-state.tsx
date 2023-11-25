'use client';

import { currencies } from '@/lib/constants';
import { useEffect, useState } from 'react';

type OnboardingState = {
   currentStep: number;
   TOTAL_STEPS: number;
   name: string;
   isInvalidName: boolean;
   organizationName: string;
   useSuggestedOrgName: boolean;
   isInvalidOrganizationName: boolean;
   suggestedOrgName: string;
   storeName: string;
   lowStockThreshold?: number;
   isInvalidLowStockThreshold: boolean;
   isInvalidStoreName: boolean;
   currency: string;
   currencies: { label: string; value: string }[];
   isSubmitting: boolean;
   isRedirecting: boolean;
};

export const useOnboarding = () => {
   const [state, setState] = useState<OnboardingState>({
      currentStep: 0,
      TOTAL_STEPS: 3,
      name: '',
      isInvalidName: false,
      organizationName: '',
      useSuggestedOrgName: false,
      isInvalidOrganizationName: false,
      suggestedOrgName: '',
      storeName: '',
      isInvalidStoreName: false,
      lowStockThreshold: undefined,
      isInvalidLowStockThreshold: false,
      currency: '',
      currencies: currencies,
      isSubmitting: false,
      isRedirecting: false,
   });

   useEffect(() => {
      const searchParams = new URLSearchParams(window.location.search);
      const initialName = searchParams.get('name');
      if (initialName) {
         handleEnteredName(initialName);
         // Optionally, update the URL
         searchParams.delete('name');
         window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${
               searchParams.toString() ? `?${searchParams}` : ''
            }`,
         );
      }
   }, []);

   useEffect(() => {
      if (state.useSuggestedOrgName) {
         handleOrgNameChange(`${state.name}'s organization`);
      } else {
         handleOrgNameChange('');
      }
   }, [state.useSuggestedOrgName, state.name]);

   const handleNext = () => {
      if (state.currentStep < state.TOTAL_STEPS) {
         setState((prevState) => ({
            ...prevState,
            currentStep: prevState.currentStep + 1,
         }));
      }
   };

   const handleBack = () => {
      if (state.currentStep > 0) {
         setState((prevState) => ({
            ...prevState,
            currentStep: prevState.currentStep - 1,
         }));
      }
   };

   const handleEnteredName = (name: string) => {
      setState((prevState) => ({
         ...prevState,
         name,
         suggestedOrgName: `${name}'s organization`,
         isInvalidName: false,
      }));
   };

   const handleOrgNameChange = (orgName: string) => {
      setState((prevState) => ({
         ...prevState,
         organizationName: orgName,
         isInvalidOrganizationName: false,
      }));
   };

   const handleUseSuggestedToggle = () => {
      setState((prevState) => ({
         ...prevState,
         useSuggestedOrgName: !prevState.useSuggestedOrgName,
      }));
   };

   const handleStoreNameChange = (storeName: string) => {
      setState((prevState) => ({
         ...prevState,
         storeName,
         isInvalidStoreName: false,
      }));
   };

   const handleEnteredLowStockThreshold = (threshold: string) => {
      setState((prevState) => ({
         ...prevState,
         lowStockThreshold: parseInt(threshold),
         isInvalidLowStockThreshold: false,
      }));
   };

   const handleCurrencyChange = (currency: string) => {
      setState((prevState) => ({ ...prevState, currency }));
   };

   const toggleInvalidInput = (
      inputType: 'name' | 'storeName' | 'orgName' | 'lowStockThreshold',
      isValid: boolean,
   ) => {
      switch (inputType) {
         case 'name':
            setState((prevState) => ({ ...prevState, isInvalidName: isValid }));
            break;
         case 'storeName':
            setState((prevState) => ({
               ...prevState,
               isInvalidStoreName: isValid,
            }));
            break;
         case 'orgName':
            setState((prevState) => ({
               ...prevState,
               isInvalidOrganizationName: isValid,
            }));
            break;

         case 'lowStockThreshold':
            setState((prevState) => ({
               ...prevState,
               isInvalidLowStockThreshold: isValid,
            }));
            break;
         default:
            break;
      }
   };

   return {
      ...state,
      handleNext,
      handleBack,
      handleEnteredName,
      handleOrgNameChange,
      handleUseSuggestedToggle,
      handleStoreNameChange,
      handleCurrencyChange,
      handleEnteredLowStockThreshold,
      toggleInvalidInput,
   };
};
