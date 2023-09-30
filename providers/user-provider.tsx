'use client';

import { useUserStore } from '@/hooks/use-user';
import { requestData } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

interface UserProviderProps {
   children: React.ReactNode;
}
export const UserProvider: React.FC<UserProviderProps> = ({ children }) => {
   const setUser = useUserStore((state) => state.setUser);
   const [isMounted, setIsMounted] = useState(false);

   console.log('[UserProvider] beginning operations');

   const fetchUserData = async () => {
      console.log('[UserProvider fetchUserData] fetching user...');
      try {
         const response = await fetch('/api/users');
         return await response.json();
      } catch (error) {
         console.log(
            '[UserProvider fetchUserData] error:',
            (error as Error).message,
         );
      }
   };

   const { data: userData, isLoading } = useQuery({
      queryKey: ['user-data'],
      queryFn: () => fetchUserData(),
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      enabled: true,
   });

   if (userData) {
      console.log('[UserProvider] user data:', userData);
      setUser(userData.name, userData.email, userData.id, userData.storeId);
   }

   useEffect(() => {
      setIsMounted(true);
   }, []);

   if (!isMounted) {
      return null;
   }

   return <>{children}</>;
};
