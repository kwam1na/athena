'use client'
import { createBrowserClient } from "@supabase/ssr";
import { useEffect } from "react";
import axios from 'axios';

export default function AuthListener() {
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'TOKEN_REFRESHED' && session) {
        try {
          await axios.post('/api/v1/update-tokens', {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          });
        } catch (error) {
          console.error('Error updating tokens:', error);
        }
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  return null;
}