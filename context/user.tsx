import {
  createContext,
  useState,
  useEffect,
  useContext,
  ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/router";
import { db } from "@/db";
import axiosInstance from "@/lib/axios";
import { UserProfile } from "@/lib/types";

interface AuthContextType {
  user: UserProfile | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  login: async () => {},
  logout: async () => {},
  isLoading: false,
});

const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const updateUserProfile = async () => {
      const sessionUser = await db.auth.getSessionUser();

      if (sessionUser) {
        const { data: user } = await axiosInstance.get(
          `/profiles/${sessionUser.id}`
        );
        setUser(user);
      } else {
        console.log("error setting user");
      }

      setIsLoading(false);
    };

    supabase.auth.onAuthStateChange((_, session) => {
      if (session) {
        updateUserProfile();
      } else {
        setUser(null);
      }
    });

    updateUserProfile();
  }, []);

  const login = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
    });
  };

  const logout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  const value: AuthContextType = {
    user,
    login,
    logout,
    isLoading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);

export default AuthProvider;
