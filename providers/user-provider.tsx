'use client';

import axios from 'axios';
import React, {
   createContext,
   useState,
   useEffect,
   useContext,
   useMemo,
} from 'react';

export interface UserProfile {
   id?: string;
   name?: string;
   email?: string;
   store_id?: string;
   created_at?: Date;
   updated_at?: Date;
   role?: string;
}

type UserContextType = {
   isLoadingUser: boolean;
   user: UserProfile;
   setUser: React.Dispatch<React.SetStateAction<UserProfile>>;
};

const UserContext = createContext<UserContextType | null>(null);

export const useUser = () => {
   const context = useContext(UserContext);
   if (!context) {
      throw new Error('useUser must be used within a UserProvider');
   }
   return context;
};

export const UserProvider = ({ children }: { children: React.ReactNode }) => {
   const [user, setUser] = useState<UserProfile>({});
   const [isLoadingUser, setIsLoadingUser] = useState(true);
   const contextValue = useMemo(
      () => ({ isLoadingUser, user, setUser }),
      [user],
   );

   useEffect(() => {
      const fetchUser = async () => {
         setIsLoadingUser(true);
         const res = await axios.get(`/api/v1/users`);
         const user = res?.data || {};
         setUser(user);
         setIsLoadingUser(false);
      };

      fetchUser();
   }, []);

   return (
      <UserContext.Provider value={contextValue}>
         {children}
      </UserContext.Provider>
   );
};
