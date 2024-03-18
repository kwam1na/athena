'use client';

// import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// import { useState } from 'react';

// export default function QCProvider({
//    children,
// }: {
//    children: React.ReactNode;
// }) {
//    const [client] = useState(new QueryClient());

//    return (
//       <QueryClientProvider client={client}>
//          {children}
//          <ReactQueryDevtools initialIsOpen={false} />
//       </QueryClientProvider>
//    );
// }

import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export const ReactQueryClientProvider = ({
   children,
}: {
   children: React.ReactNode;
}) => {
   const [queryClient] = useState(
      () =>
         new QueryClient({
            defaultOptions: {
               queries: {
                  staleTime: 60 * 1000,
               },
            },
         }),
   );
   return (
      <QueryClientProvider client={queryClient}>
         {children}
         <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
   );
};
