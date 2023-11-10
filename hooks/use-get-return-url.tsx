'use client';

import useGetBaseStoreUrl from './use-get-base-store-url';

function useReturnUrl(defaultPath: string) {
   const baseStoreURL = useGetBaseStoreUrl();

   const getReturnUrl = () => {
      const searchParams = new URLSearchParams(window.location.search);
      let returnUrlBase =
         searchParams.get('return_url') || `${baseStoreURL}${defaultPath}`;

      let additionalParams = '';
      for (let [key, value] of searchParams.entries()) {
         if (key !== 'return_url') {
            additionalParams += `${key}=${value}&`;
         }
      }

      return additionalParams
         ? `${returnUrlBase}?${additionalParams.slice(0, -1)}`
         : returnUrlBase;
   };

   return getReturnUrl;
}

export default useReturnUrl;
