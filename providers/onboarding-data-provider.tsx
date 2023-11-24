'use client';

import { LocalStorageSync } from '@/lib/local-storage-sync';
import { usePathname, useRouter } from 'next/navigation';
import React, {
   createContext,
   useState,
   useEffect,
   useContext,
   useMemo,
} from 'react';

type OnboardingDataContextType = {
   categoryId?: string;
   setCategoryId: React.Dispatch<React.SetStateAction<string | undefined>>;
   categoryName?: string;
   setCategoryName: React.Dispatch<React.SetStateAction<string | undefined>>;
   organizationId?: string;
   setOrganizationId: React.Dispatch<React.SetStateAction<string | undefined>>;
   storeId?: number;
   setStoreId: React.Dispatch<React.SetStateAction<number | undefined>>;
   subcategoryId?: string;
   setSubcategoryId: React.Dispatch<React.SetStateAction<string | undefined>>;
   subcategoryName?: string;
   setSubcategoryName: React.Dispatch<React.SetStateAction<string | undefined>>;
};

const OnboardingDataContext = createContext<OnboardingDataContextType | null>(
   null,
);

export const useOnboardingData = () => {
   const context = useContext(OnboardingDataContext);
   if (!context) {
      throw new Error(
         'useOnboardingData must be used within a OnboardingDataProvider',
      );
   }
   return context;
};

export const OnboardingDataProvider = ({
   children,
}: {
   children: React.ReactNode;
}) => {
   const router = useRouter();
   const pathName = usePathname();

   const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
   const [categoryName, setCategoryName] = useState<string | undefined>(
      undefined,
   );
   const [organizationId, setOrganizationId] = useState<string | undefined>(
      undefined,
   );
   const [storeId, setStoreId] = useState<number | undefined>(undefined);
   const [subcategoryId, setSubcategoryId] = useState<string | undefined>(
      undefined,
   );
   const [subcategoryName, setSubcategoryName] = useState<string | undefined>(
      undefined,
   );

   // Load saved data from localStorage on client-side mount
   useEffect(() => {
      const onboardingAutoSaver = new LocalStorageSync('onboarding');
      const savedData = onboardingAutoSaver.getAll();
      const {
         categoryId,
         categoryName,
         organizationId,
         storeId,
         subcategoryId,
         subcategoryName,
      } = savedData;
      setCategoryId(categoryId);
      setCategoryName(categoryName);
      setOrganizationId(organizationId);
      setStoreId(storeId);
      setSubcategoryId(subcategoryId);
      setSubcategoryName(subcategoryName);

      // Redirect if necessary data is missing and not on initial onboarding page
      if (
         !savedData.organizationId &&
         !savedData.storeId &&
         pathName !== '/onboarding'
      ) {
         router.replace('/');
      }
   }, []);

   useEffect(() => {
      const onboardingAutoSaver = new LocalStorageSync('onboarding');
      const dataToSave = {
         categoryId,
         categoryName,
         organizationId,
         storeId,
         subcategoryId,
         subcategoryName,
      };
      onboardingAutoSaver.save(dataToSave);
   }, [
      categoryId,
      categoryName,
      organizationId,
      storeId,
      subcategoryId,
      subcategoryName,
   ]);

   const contextValue = useMemo(
      () => ({
         categoryId,
         setCategoryId,
         categoryName,
         setCategoryName,
         organizationId,
         setOrganizationId,
         storeId,
         setStoreId,
         subcategoryId,
         setSubcategoryId,
         subcategoryName,
         setSubcategoryName,
      }),
      [
         categoryId,
         categoryName,
         organizationId,
         storeId,
         subcategoryId,
         subcategoryName,
      ],
   );

   return (
      <OnboardingDataContext.Provider value={contextValue}>
         {children}
      </OnboardingDataContext.Provider>
   );
};
