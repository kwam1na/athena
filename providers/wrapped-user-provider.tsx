'use client';

import axios from 'axios';
import React, {
   createContext,
   useState,
   useEffect,
   useContext,
   useMemo,
} from 'react';

export interface WrappedUserProfile {
   name?: string;
   email?: string;
   store_id?: string;
   created_at?: Date;
   updated_at?: Date;
}

type WrappedUserContextType = {
   isLoading: boolean;
   wrappedUser: WrappedUserProfile;
   setWrappedUser: React.Dispatch<React.SetStateAction<WrappedUserProfile>>;
};

const WrappedUserContext = createContext<WrappedUserContextType | null>(null);

export const useWrappedUser = () => {
   const context = useContext(WrappedUserContext);
   if (!context) {
      throw new Error(
         'useWrappedUser must be used within a WrappedUserProvider',
      );
   }
   return context;
};

export const WrappedUserProvider = ({
   children,
}: {
   children: React.ReactNode;
}) => {
   const [wrappedUser, setWrappedUser] = useState<WrappedUserProfile>({});
   const [isLoading, setIsLoading] = useState(true);
   const contextValue = useMemo(
      () => ({ isLoading, wrappedUser, setWrappedUser }),
      [wrappedUser],
   );

   useEffect(() => {
      const fetchUser = async () => {
         setIsLoading(true);
         const res = await axios.get(`/api/v1/users`);
         const user = res?.data || {};
         setWrappedUser(user);
         setIsLoading(false);
      };

      fetchUser();
   }, []);

   return (
      <WrappedUserContext.Provider value={contextValue}>
         {children}
      </WrappedUserContext.Provider>
   );
};
