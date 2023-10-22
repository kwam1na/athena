'use client';

import { useParams } from 'next/navigation';

function useReturnUrl(defaultPath: string) {
   const params = useParams();

   const getReturnUrl = () => {
      const searchParams = new URLSearchParams(window.location.search);
      let returnUrlBase =
         searchParams.get('return_url') || `/${params.storeId}${defaultPath}`;

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
