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
}

type UserContextType = {
   isLoading: boolean;
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
   const [isLoading, setIsLoading] = useState(true);
   const contextValue = useMemo(() => ({ isLoading, user, setUser }), [user]);

   useEffect(() => {
      const fetchUser = async () => {
         setIsLoading(true);
         const res = await axios.get(`/api/v1/users`);
         const user = res?.data || {};
         setUser(user);
         setIsLoading(false);
      };

      fetchUser();
   }, []);

   return (
      <UserContext.Provider value={contextValue}>
         {children}
      </UserContext.Provider>
   );
};
