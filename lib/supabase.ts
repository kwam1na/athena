import { createClient, User as SupabaseUser } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY || "";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export type User = SupabaseUser;
