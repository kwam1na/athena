import { Store } from "@/lib/types";
import { supabase } from "@/lib/supabase";

export async function getStore(id: string): Promise<Store | null> {
  const { data } = await supabase.from("stores").select("*").match({ id });
  return data?.[0] as Store;
}
