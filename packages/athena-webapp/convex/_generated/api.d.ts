/* prettier-ignore-start */

/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as app from "../app.js";
import type * as auth from "../auth.js";
import type * as env from "../env.js";
import type * as http_domains_inventory_routes_categories from "../http/domains/inventory/routes/categories.js";
import type * as http_domains_inventory_routes_index from "../http/domains/inventory/routes/index.js";
import type * as http_domains_inventory_routes_organizations from "../http/domains/inventory/routes/organizations.js";
import type * as http_domains_inventory_routes_products from "../http/domains/inventory/routes/products.js";
import type * as http_domains_inventory_routes_stores from "../http/domains/inventory/routes/stores.js";
import type * as http_domains_inventory_routes_subcategories from "../http/domains/inventory/routes/subcategories.js";
import type * as http_domains_storeFront_routes_bag from "../http/domains/storeFront/routes/bag.js";
import type * as http_domains_storeFront_routes_guest from "../http/domains/storeFront/routes/guest.js";
import type * as http_domains_storeFront_routes_index from "../http/domains/storeFront/routes/index.js";
import type * as http from "../http.js";
import type * as inventory_categories from "../inventory/categories.js";
import type * as inventory_organizations from "../inventory/organizations.js";
import type * as inventory_products from "../inventory/products.js";
import type * as inventory_stores from "../inventory/stores.js";
import type * as inventory_subcategories from "../inventory/subcategories.js";
import type * as otp_ResendOTP from "../otp/ResendOTP.js";
import type * as otp_VerificationCodeEmail from "../otp/VerificationCodeEmail.js";
import type * as schemas_inventory_category from "../schemas/inventory/category.js";
import type * as schemas_inventory_index from "../schemas/inventory/index.js";
import type * as schemas_inventory_organization from "../schemas/inventory/organization.js";
import type * as schemas_inventory_product from "../schemas/inventory/product.js";
import type * as schemas_inventory_store from "../schemas/inventory/store.js";
import type * as schemas_inventory_subcategory from "../schemas/inventory/subcategory.js";
import type * as schemas_storeFront_bag from "../schemas/storeFront/bag.js";
import type * as schemas_storeFront_bagItem from "../schemas/storeFront/bagItem.js";
import type * as schemas_storeFront_customer from "../schemas/storeFront/customer.js";
import type * as schemas_storeFront_guest from "../schemas/storeFront/guest.js";
import type * as schemas_storeFront_index from "../schemas/storeFront/index.js";
import type * as storeFront_bag from "../storeFront/bag.js";
import type * as storeFront_bagItem from "../storeFront/bagItem.js";
import type * as storeFront_guest from "../storeFront/guest.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  app: typeof app;
  auth: typeof auth;
  env: typeof env;
  "http/domains/inventory/routes/categories": typeof http_domains_inventory_routes_categories;
  "http/domains/inventory/routes/index": typeof http_domains_inventory_routes_index;
  "http/domains/inventory/routes/organizations": typeof http_domains_inventory_routes_organizations;
  "http/domains/inventory/routes/products": typeof http_domains_inventory_routes_products;
  "http/domains/inventory/routes/stores": typeof http_domains_inventory_routes_stores;
  "http/domains/inventory/routes/subcategories": typeof http_domains_inventory_routes_subcategories;
  "http/domains/storeFront/routes/bag": typeof http_domains_storeFront_routes_bag;
  "http/domains/storeFront/routes/guest": typeof http_domains_storeFront_routes_guest;
  "http/domains/storeFront/routes/index": typeof http_domains_storeFront_routes_index;
  http: typeof http;
  "inventory/categories": typeof inventory_categories;
  "inventory/organizations": typeof inventory_organizations;
  "inventory/products": typeof inventory_products;
  "inventory/stores": typeof inventory_stores;
  "inventory/subcategories": typeof inventory_subcategories;
  "otp/ResendOTP": typeof otp_ResendOTP;
  "otp/VerificationCodeEmail": typeof otp_VerificationCodeEmail;
  "schemas/inventory/category": typeof schemas_inventory_category;
  "schemas/inventory/index": typeof schemas_inventory_index;
  "schemas/inventory/organization": typeof schemas_inventory_organization;
  "schemas/inventory/product": typeof schemas_inventory_product;
  "schemas/inventory/store": typeof schemas_inventory_store;
  "schemas/inventory/subcategory": typeof schemas_inventory_subcategory;
  "schemas/storeFront/bag": typeof schemas_storeFront_bag;
  "schemas/storeFront/bagItem": typeof schemas_storeFront_bagItem;
  "schemas/storeFront/customer": typeof schemas_storeFront_customer;
  "schemas/storeFront/guest": typeof schemas_storeFront_guest;
  "schemas/storeFront/index": typeof schemas_storeFront_index;
  "storeFront/bag": typeof storeFront_bag;
  "storeFront/bagItem": typeof storeFront_bagItem;
  "storeFront/guest": typeof storeFront_guest;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

/* prettier-ignore-end */
