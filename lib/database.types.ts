export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[];

export interface Database {
    public: {
        Tables: {
            _prisma_migrations: {
                Row: {
                    applied_steps_count: number;
                    checksum: string;
                    finished_at: string | null;
                    id: string;
                    logs: string | null;
                    migration_name: string;
                    rolled_back_at: string | null;
                    started_at: string;
                };
                Insert: {
                    applied_steps_count?: number;
                    checksum: string;
                    finished_at?: string | null;
                    id: string;
                    logs?: string | null;
                    migration_name: string;
                    rolled_back_at?: string | null;
                    started_at?: string;
                };
                Update: {
                    applied_steps_count?: number;
                    checksum?: string;
                    finished_at?: string | null;
                    id?: string;
                    logs?: string | null;
                    migration_name?: string;
                    rolled_back_at?: string | null;
                    started_at?: string;
                };
                Relationships: [];
            };
            Billboard: {
                Row: {
                    createdAt: string;
                    id: string;
                    imageUrl: string;
                    label: string;
                    storeId: string;
                    updatedAt: string;
                };
                Insert: {
                    createdAt?: string;
                    id: string;
                    imageUrl: string;
                    label: string;
                    storeId: string;
                    updatedAt: string;
                };
                Update: {
                    createdAt?: string;
                    id?: string;
                    imageUrl?: string;
                    label?: string;
                    storeId?: string;
                    updatedAt?: string;
                };
                Relationships: [];
            };
            Category: {
                Row: {
                    billboardId: string;
                    createdAt: string;
                    id: string;
                    name: string;
                    storeId: string;
                    updatedAt: string;
                };
                Insert: {
                    billboardId: string;
                    createdAt?: string;
                    id: string;
                    name: string;
                    storeId: string;
                    updatedAt: string;
                };
                Update: {
                    billboardId?: string;
                    createdAt?: string;
                    id?: string;
                    name?: string;
                    storeId?: string;
                    updatedAt?: string;
                };
                Relationships: [];
            };
            Color: {
                Row: {
                    createdAt: string;
                    id: string;
                    name: string;
                    storeId: string;
                    updatedAt: string;
                    value: string;
                };
                Insert: {
                    createdAt?: string;
                    id: string;
                    name: string;
                    storeId: string;
                    updatedAt: string;
                    value: string;
                };
                Update: {
                    createdAt?: string;
                    id?: string;
                    name?: string;
                    storeId?: string;
                    updatedAt?: string;
                    value?: string;
                };
                Relationships: [];
            };
            Image: {
                Row: {
                    createdAt: string;
                    id: string;
                    productId: string;
                    updatedAt: string;
                    url: string;
                };
                Insert: {
                    createdAt?: string;
                    id: string;
                    productId: string;
                    updatedAt: string;
                    url: string;
                };
                Update: {
                    createdAt?: string;
                    id?: string;
                    productId?: string;
                    updatedAt?: string;
                    url?: string;
                };
                Relationships: [];
            };
            Order: {
                Row: {
                    address: string;
                    createdAt: string;
                    id: string;
                    isPaid: boolean;
                    phone: string;
                    storeId: string;
                    updatedAt: string;
                };
                Insert: {
                    address?: string;
                    createdAt?: string;
                    id: string;
                    isPaid?: boolean;
                    phone?: string;
                    storeId: string;
                    updatedAt: string;
                };
                Update: {
                    address?: string;
                    createdAt?: string;
                    id?: string;
                    isPaid?: boolean;
                    phone?: string;
                    storeId?: string;
                    updatedAt?: string;
                };
                Relationships: [];
            };
            OrderItem: {
                Row: {
                    id: string;
                    orderId: string;
                    productId: string;
                };
                Insert: {
                    id: string;
                    orderId: string;
                    productId: string;
                };
                Update: {
                    id?: string;
                    orderId?: string;
                    productId?: string;
                };
                Relationships: [];
            };
            Product: {
                Row: {
                    categoryId: string;
                    colorId: string;
                    createdAt: string;
                    id: string;
                    isArchived: boolean;
                    isFeatured: boolean;
                    name: string;
                    price: number;
                    sizeId: string;
                    storeId: string;
                    updatedAt: string;
                };
                Insert: {
                    categoryId: string;
                    colorId: string;
                    createdAt?: string;
                    id: string;
                    isArchived?: boolean;
                    isFeatured?: boolean;
                    name: string;
                    price: number;
                    sizeId: string;
                    storeId: string;
                    updatedAt: string;
                };
                Update: {
                    categoryId?: string;
                    colorId?: string;
                    createdAt?: string;
                    id?: string;
                    isArchived?: boolean;
                    isFeatured?: boolean;
                    name?: string;
                    price?: number;
                    sizeId?: string;
                    storeId?: string;
                    updatedAt?: string;
                };
                Relationships: [];
            };
            Size: {
                Row: {
                    createdAt: string;
                    id: string;
                    name: string;
                    storeId: string;
                    updatedAt: string;
                    value: string;
                };
                Insert: {
                    createdAt?: string;
                    id: string;
                    name: string;
                    storeId: string;
                    updatedAt: string;
                    value: string;
                };
                Update: {
                    createdAt?: string;
                    id?: string;
                    name?: string;
                    storeId?: string;
                    updatedAt?: string;
                    value?: string;
                };
                Relationships: [];
            };
            Store: {
                Row: {
                    createdAt: string;
                    id: string;
                    name: string;
                    updatedAt: string;
                    userId: string;
                };
                Insert: {
                    createdAt?: string;
                    id: string;
                    name: string;
                    updatedAt: string;
                    userId: string;
                };
                Update: {
                    createdAt?: string;
                    id?: string;
                    name?: string;
                    updatedAt?: string;
                    userId?: string;
                };
                Relationships: [];
            };
            User: {
                Row: {
                    createdAt: string;
                    email: string;
                    id: string;
                    name: string;
                    storeId: string | null;
                    updatedAt: string;
                };
                Insert: {
                    createdAt?: string;
                    email: string;
                    id: string;
                    name: string;
                    storeId?: string | null;
                    updatedAt: string;
                };
                Update: {
                    createdAt?: string;
                    email?: string;
                    id?: string;
                    name?: string;
                    storeId?: string | null;
                    updatedAt?: string;
                };
                Relationships: [];
            };
        };
        Views: {
            [_ in never]: never;
        };
        Functions: {
            [_ in never]: never;
        };
        Enums: {
            [_ in never]: never;
        };
        CompositeTypes: {
            [_ in never]: never;
        };
    };
}
