export interface UserProfile {
  id: string;
  store_associated_with: string;
  store: Store;
}

export type Category = {
  id: number;
  created_at: string | null;
  name: string | null;
  description: string | null;
  store_id: number | null;
};

export type Inventory = {
  id: number;
  created_at: string | null;
  date_updated: string | null;
  quantity: number | null;
  item_id: number | null;
  store_id: number | null;
};

export type Item = {
  id: number;
  created_at: string | null;
  sku: string;
  description: string | null;
  unit_price: number | null;
  name: string | null;
  color: string | null;
  manufacturer: string | null;
  subcategory_id: number | null;
};

export type Profile = {
  id: string;
  created_at: string | null;
  store_associated_with: number | null;
};

export type Store = {
  id: number;
  created_at: string | null;
  is_subscribed: boolean | null;
  name: string | null;
};

export type Subcategory = {
  id: number;
  created_at: string | null;
  category_id: number | null;
  name: string | null;
  description: string | null;
};

export type Transaction = {
  id: number;
  created_at: string | null;
  transaction_type: string | null;
  transaction_date: string | null;
  quantity: number | null;
  item_id: number | null;
  user_id: string | null;
  store_id: number | null;
};
