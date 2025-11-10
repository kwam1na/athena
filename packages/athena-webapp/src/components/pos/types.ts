import { Id } from "../../../convex/_generated/dataModel";

export interface CartItem {
  id: Id<"posSessionItem"> | Id<"posTransactionItem">; // Database ID is the single source of truth
  name: string;
  barcode: string;
  sku?: string;
  price: number;
  quantity: number;
  image?: string | null;
  size?: string;
  length?: number | null;
  productId?: Id<"product">; // Product ID for backend operations
  skuId?: Id<"productSku">; // Product SKU ID for backend operations
  areProcessingFeesAbsorbed?: boolean;
}

export interface CustomerInfo {
  customerId?: Id<"posCustomer">; // Added to link to POS customer database
  name: string;
  email: string;
  phone: string;
}

export interface Product {
  id: string;
  name: string;
  sku?: string;
  barcode: string;
  price: number;
  category: string;
  description: string;
  image?: string | null;
  inStock: boolean;
  quantityAvailable?: number;
  size?: string;
  length?: number | null;
  color?: string;
  productId?: Id<"product">;
  skuId?: Id<"productSku">;
  areProcessingFeesAbsorbed?: boolean;
}

// Dummy product data
export const DUMMY_PRODUCTS: Product[] = [
  {
    id: "1",
    name: "Organic Bananas",
    barcode: "1234567890123",
    price: 2.99,
    category: "Produce",
    description: "Fresh organic bananas - 1 bunch",
    inStock: true,
  },
  {
    id: "2",
    name: "Coca-Cola 12pk",
    barcode: "2345678901234",
    price: 5.99,
    category: "Beverages",
    description: "Coca-Cola Classic 12-pack cans",
    inStock: true,
  },
  {
    id: "3",
    name: "Wonder Bread",
    barcode: "3456789012345",
    price: 3.49,
    category: "Bakery",
    description: "Wonder Bread Classic White - 20oz loaf",
    inStock: true,
  },
  {
    id: "4",
    name: "Tide Laundry Detergent",
    barcode: "4567890123456",
    price: 12.99,
    category: "Household",
    description: "Tide Original Scent 64 loads",
    inStock: true,
  },
  {
    id: "5",
    name: "Ground Beef 80/20",
    barcode: "5678901234567",
    price: 8.99,
    category: "Meat",
    description: "Fresh ground beef 80/20 - 1 lb",
    inStock: true,
  },
  {
    id: "6",
    name: "iPhone Charger Cable",
    barcode: "6789012345678",
    price: 19.99,
    category: "Electronics",
    description: "Lightning to USB-C cable - 6ft",
    inStock: false,
  },
  {
    id: "7",
    name: "Milk 2% Gallon",
    barcode: "7890123456789",
    price: 4.29,
    category: "Dairy",
    description: "Fresh 2% milk - 1 gallon",
    inStock: true,
  },
  {
    id: "8",
    name: "Doritos Nacho Cheese",
    barcode: "8901234567890",
    price: 4.99,
    category: "Snacks",
    description: "Doritos Nacho Cheese flavored tortilla chips",
    inStock: true,
  },
];

export const CATEGORIES = [
  "All",
  "Produce",
  "Beverages",
  "Bakery",
  "Household",
  "Meat",
  "Electronics",
  "Dairy",
  "Snacks",
];
