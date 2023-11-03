'use client';

import { currencies } from '@/lib/constants';
import { useEffect, useState } from 'react';

// export const useOnboardingState = () => {
//    const [isSubmitting, setIsSubmitting] = useState(false);
//    const [name, setName] = useState('');
//    const [organizationName, setOrganizationName] = useState('');
//    const [useSuggestedOrgName, setUseSuggestedOrgName] = useState(false);
//    const [storeName, setStoreName] = useState('');
//    const [currency, setCurrency] = useState('');
//    const [activeStep, setActiveStep] = useState(0);
//    const [isInvalidName, setIsInvalidName] = useState(false);
//    const [isInvalidStoreName, setIsInvalidStoreName] = useState(false);
//    const [isInvalidOrganizationName, setIsInvalidOrganizationName] =
//       useState(false);
//    const [isRedirecting, setIsRedirecting] = useState(false);
//    const TOTAL_STEPS = 3;

//    useEffect(() => {
//       const searchParams = new URLSearchParams(window.location.search);
//       setName(searchParams.get('name') || '');
//       searchParams.delete('name');
//       window.history.replaceState(
//          null,
//          '',
//          searchParams.toString() || window.location.pathname,
//       );
//    }, []);

//    useEffect(() => {
//       if (useSuggestedOrgName) {
//          setOrganizationName(`${name}'s organization`);
//       } else {
//          setOrganizationName('');
//       }
//    }, [useSuggestedOrgName, name]);

//    return {
//       isSubmitting,
//       setIsSubmitting,
//       name,
//       setName,
//       organizationName,
//       setOrganizationName,
//       useSuggestedOrgName,
//       setUseSuggestedOrgName,
//       storeName,
//       setStoreName,
//       currency,
//       setCurrency,
//       activeStep,
//       setActiveStep,
//       isInvalidName,
//       setIsInvalidName,
//       isInvalidStoreName,
//       setIsInvalidStoreName,
//       isInvalidOrganizationName,
//       setIsInvalidOrganizationName,
//       isRedirecting,
//       setIsRedirecting,
//       TOTAL_STEPS,
//    };
// };

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
      currency: '',
      currencies: currencies,
      isSubmitting: false,
      isRedirecting: false,
   });

   useEffect(() => {
      const searchParams = new URLSearchParams(window.location.search);
      handleEnteredName(searchParams.get('name') || '');
      searchParams.delete('name');
      window.history.replaceState(
         null,
         '',
         searchParams.toString() || window.location.pathname,
      );
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

   const handleCurrencyChange = (currency: string) => {
      setState((prevState) => ({ ...prevState, currency }));
   };

   const toggleInvalidInput = (
      inputType: 'name' | 'storeName' | 'orgName',
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
      toggleInvalidInput,
   };
};
