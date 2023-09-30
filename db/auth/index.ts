import { supabase, User } from "@/lib/supabase";

export async function getSessionUser(): Promise<User | null> {
  const sessionUser = (await supabase.auth.getUser()).data.user;
  return sessionUser;
}
