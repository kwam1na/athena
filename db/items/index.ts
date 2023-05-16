import { supabase } from "@/lib/supabase";
import { Item } from "@/lib/types";

export const getItems = async (): Promise<Item[]> => {
  const { data, error } = await supabase.from("items").select("*");
  if (error) {
    throw new Error("Error fetching items");
  }

  return data as Item[];
};

export const getItemById = async (id: string): Promise<Item | null> => {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    throw new Error(`Error fetching item with id ${id}`);
  }

  return data as Item;
};

export const createItem = async (item: Partial<Item>): Promise<Item> => {
  const { data, error } = await supabase
    .from("items")
    .insert(item)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Item;
};

export const updateItem = async (
  id: string,
  item: Partial<Item>
): Promise<Item> => {
  item.date_updated = new Date().toISOString();
  const { data, error } = await supabase
    .from("items")
    .update(item)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Item;
};

export const deleteItem = async (id: string): Promise<void> => {
  const { error } = await supabase.from("items").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
};
