import { supabase } from "@/lib/supabase";
import { Transaction } from "@/lib/types";

const TABLE_NAME = "transactions";

export const getTransactions = async (): Promise<Transaction[]> => {
  const { data, error } = await supabase.from(TABLE_NAME).select("*");
  if (error) {
    throw new Error(`Error fetching ${TABLE_NAME}`);
  }

  return data as Transaction[];
};

export const getTransactionById = async (
  id: string
): Promise<Transaction | null> => {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    throw new Error(`Error fetching item with id ${id}`);
  }

  return data as Transaction;
};

export const createTransaction = async (
  item: Partial<Transaction>
): Promise<Transaction> => {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert(item)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Transaction;
};

export const deleteTransaction = async (id: string): Promise<void> => {
  const { error } = await supabase.from(TABLE_NAME).delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
};
