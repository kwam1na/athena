import { UserProfile } from "@/lib/types";
import { supabase } from "@/lib/supabase";

export async function getUserProfile(id: string): Promise<UserProfile | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", id);

  return profile?.[0] as UserProfile;
}
