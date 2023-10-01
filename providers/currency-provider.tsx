'use client';

import axios from 'axios';
import { useParams } from 'next/navigation';
import React, {
   createContext,
   useState,
   useEffect,
   useContext,
   useMemo,
} from 'react';

type CurrencyContextType = {
   storeCurrency: string;
   setStoreCurrency: React.Dispatch<React.SetStateAction<string>>;
};

const CurrencyContext = createContext<CurrencyContextType | null>(null);

export const useStoreCurrency = () => {
   const context = useContext(CurrencyContext);
   if (!context) {
      throw new Error('useCurrency must be used within a CurrencyProvider');
   }
   return context;
};

export const CurrencyProvider = ({
   children,
}: {
   children: React.ReactNode;
}) => {
   const [storeCurrency, setStoreCurrency] = useState('USD');
   const contextValue = useMemo(
      () => ({ storeCurrency, setStoreCurrency }),
      [storeCurrency],
   );
   const params = useParams();

   useEffect(() => {
      const fetchStoreCurrency = async () => {
         const res = await axios.get(`/api/stores/${params.storeId}`);
         const { currency } = res?.data || {};
         setStoreCurrency(currency);
      };

      fetchStoreCurrency();
   }, []);

   return (
      <CurrencyContext.Provider value={contextValue}>
         {children}
      </CurrencyContext.Provider>
   );
};
