'use client';

import { useParams } from 'next/navigation';
import React, { createContext, useState, useContext, useMemo } from 'react';

type ExhangeRateContextType = {
   exchangeRate: number;
   // setExchangeRate: React.Dispatch<React.SetStateAction<number>>;
};

const ExchangeRateContext = createContext<ExhangeRateContextType | null>(null);

export const useExchangeRate = () => {
   const context = useContext(ExchangeRateContext);
   if (!context) {
      throw new Error(
         'useExchangeRate must be used within a ExhangeRateProvider',
      );
   }
   return context;
};

export const ExchangeRateProvider = ({
   children,
}: {
   children: React.ReactNode;
}) => {
   const [exchangeRate, setExchangeRate] = useState(1);
   const contextValue = useMemo(() => ({ exchangeRate }), [exchangeRate]);
   const params = useParams();

   // useEffect(() => {
   //    const fetchExchangeRate = async () => {
   //       const res = await axios.get(`/api/exchange-rate/${params.storeId}`);
   //       const { rate } = res?.data || {};
   //       console.log('exchage rate:', rate);
   //       setExchangeRate(rate as number);
   //       // setExchangeRate(storeCurrency == 'usd' ? 1 : 11.18);
   //    };

   //    fetchExchangeRate();
   // }, []);

   return (
      <ExchangeRateContext.Provider value={contextValue}>
         {children}
      </ExchangeRateContext.Provider>
   );
};
