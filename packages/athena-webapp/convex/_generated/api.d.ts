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
import type * as aws_aws from "../aws/aws.js";
import type * as cache_index from "../cache/index.js";
import type * as constants_countries from "../constants/countries.js";
import type * as constants_ghana from "../constants/ghana.js";
import type * as crons from "../crons.js";
import type * as env from "../env.js";
import type * as http_domains_inventory_routes_analytics from "../http/domains/inventory/routes/analytics.js";
import type * as http_domains_inventory_routes_auth from "../http/domains/inventory/routes/auth.js";
import type * as http_domains_inventory_routes_categories from "../http/domains/inventory/routes/categories.js";
import type * as http_domains_inventory_routes_colors from "../http/domains/inventory/routes/colors.js";
import type * as http_domains_inventory_routes_index from "../http/domains/inventory/routes/index.js";
import type * as http_domains_inventory_routes_organizations from "../http/domains/inventory/routes/organizations.js";
import type * as http_domains_inventory_routes_products from "../http/domains/inventory/routes/products.js";
import type * as http_domains_inventory_routes_stores from "../http/domains/inventory/routes/stores.js";
import type * as http_domains_inventory_routes_subcategories from "../http/domains/inventory/routes/subcategories.js";
import type * as http_domains_storeFront_routes_bag from "../http/domains/storeFront/routes/bag.js";
import type * as http_domains_storeFront_routes_checkout from "../http/domains/storeFront/routes/checkout.js";
import type * as http_domains_storeFront_routes_guest from "../http/domains/storeFront/routes/guest.js";
import type * as http_domains_storeFront_routes_index from "../http/domains/storeFront/routes/index.js";
import type * as http_domains_storeFront_routes_me from "../http/domains/storeFront/routes/me.js";
import type * as http_domains_storeFront_routes_offers from "../http/domains/storeFront/routes/offers.js";
import type * as http_domains_storeFront_routes_onlineOrder from "../http/domains/storeFront/routes/onlineOrder.js";
import type * as http_domains_storeFront_routes_paystack from "../http/domains/storeFront/routes/paystack.js";
import type * as http_domains_storeFront_routes_reviews from "../http/domains/storeFront/routes/reviews.js";
import type * as http_domains_storeFront_routes_rewards from "../http/domains/storeFront/routes/rewards.js";
import type * as http_domains_storeFront_routes_savedBag from "../http/domains/storeFront/routes/savedBag.js";
import type * as http_domains_storeFront_routes_storefront from "../http/domains/storeFront/routes/storefront.js";
import type * as http_domains_storeFront_routes_upsells from "../http/domains/storeFront/routes/upsells.js";
import type * as http_domains_storeFront_routes_user from "../http/domains/storeFront/routes/user.js";
import type * as http_domains_storeFront_routes_userOffers from "../http/domains/storeFront/routes/userOffers.js";
import type * as http_utils from "../http/utils.js";
import type * as http from "../http.js";
import type * as inventory_athenaUser from "../inventory/athenaUser.js";
import type * as inventory_auth from "../inventory/auth.js";
import type * as inventory_bestSeller from "../inventory/bestSeller.js";
import type * as inventory_categories from "../inventory/categories.js";
import type * as inventory_colors from "../inventory/colors.js";
import type * as inventory_complimentaryProduct from "../inventory/complimentaryProduct.js";
import type * as inventory_featuredItem from "../inventory/featuredItem.js";
import type * as inventory_inviteCode from "../inventory/inviteCode.js";
import type * as inventory_organizationMembers from "../inventory/organizationMembers.js";
import type * as inventory_organizations from "../inventory/organizations.js";
import type * as inventory_pos from "../inventory/pos.js";
import type * as inventory_posCustomers from "../inventory/posCustomers.js";
import type * as inventory_posSessions from "../inventory/posSessions.js";
import type * as inventory_productSku from "../inventory/productSku.js";
import type * as inventory_productUtil from "../inventory/productUtil.js";
import type * as inventory_products from "../inventory/products.js";
import type * as inventory_promoCode from "../inventory/promoCode.js";
import type * as inventory_stockValidation from "../inventory/stockValidation.js";
import type * as inventory_stores from "../inventory/stores.js";
import type * as inventory_subcategories from "../inventory/subcategories.js";
import type * as inventory_utils from "../inventory/utils.js";
import type * as llm_callLlmProvider from "../llm/callLlmProvider.js";
import type * as llm_providers_anthropic from "../llm/providers/anthropic.js";
import type * as llm_providers_openai from "../llm/providers/openai.js";
import type * as llm_storeInsights from "../llm/storeInsights.js";
import type * as llm_userInsights from "../llm/userInsights.js";
import type * as llm_utils_analyticsUtils from "../llm/utils/analyticsUtils.js";
import type * as otp_ResendOTP from "../otp/ResendOTP.js";
import type * as otp_VerificationCodeEmail from "../otp/VerificationCodeEmail.js";
import type * as paystack_index from "../paystack/index.js";
import type * as schemas_inventory_appVerificationCode from "../schemas/inventory/appVerificationCode.js";
import type * as schemas_inventory_athenaUser from "../schemas/inventory/athenaUser.js";
import type * as schemas_inventory_bestSeller from "../schemas/inventory/bestSeller.js";
import type * as schemas_inventory_category from "../schemas/inventory/category.js";
import type * as schemas_inventory_color from "../schemas/inventory/color.js";
import type * as schemas_inventory_complimentaryProduct from "../schemas/inventory/complimentaryProduct.js";
import type * as schemas_inventory_featuredItem from "../schemas/inventory/featuredItem.js";
import type * as schemas_inventory_index from "../schemas/inventory/index.js";
import type * as schemas_inventory_inviteCode from "../schemas/inventory/inviteCode.js";
import type * as schemas_inventory_organization from "../schemas/inventory/organization.js";
import type * as schemas_inventory_organizationMember from "../schemas/inventory/organizationMember.js";
import type * as schemas_inventory_product from "../schemas/inventory/product.js";
import type * as schemas_inventory_promoCode from "../schemas/inventory/promoCode.js";
import type * as schemas_inventory_redeemedPromoCode from "../schemas/inventory/redeemedPromoCode.js";
import type * as schemas_inventory_store from "../schemas/inventory/store.js";
import type * as schemas_inventory_subcategory from "../schemas/inventory/subcategory.js";
import type * as schemas_pos_customer from "../schemas/pos/customer.js";
import type * as schemas_pos_index from "../schemas/pos/index.js";
import type * as schemas_pos_posSession from "../schemas/pos/posSession.js";
import type * as schemas_pos_posTransaction from "../schemas/pos/posTransaction.js";
import type * as schemas_pos_posTransactionItem from "../schemas/pos/posTransactionItem.js";
import type * as schemas_storeFront_analytics from "../schemas/storeFront/analytics.js";
import type * as schemas_storeFront_bag from "../schemas/storeFront/bag.js";
import type * as schemas_storeFront_bagItem from "../schemas/storeFront/bagItem.js";
import type * as schemas_storeFront_checkoutSession from "../schemas/storeFront/checkoutSession.js";
import type * as schemas_storeFront_checkoutSessionItem from "../schemas/storeFront/checkoutSessionItem.js";
import type * as schemas_storeFront_customer from "../schemas/storeFront/customer.js";
import type * as schemas_storeFront_guest from "../schemas/storeFront/guest.js";
import type * as schemas_storeFront_index from "../schemas/storeFront/index.js";
import type * as schemas_storeFront_offer from "../schemas/storeFront/offer.js";
import type * as schemas_storeFront_onlineOrder_onlineOrder from "../schemas/storeFront/onlineOrder/onlineOrder.js";
import type * as schemas_storeFront_onlineOrder_onlineOrderItem from "../schemas/storeFront/onlineOrder/onlineOrderItem.js";
import type * as schemas_storeFront_review from "../schemas/storeFront/review.js";
import type * as schemas_storeFront_rewards from "../schemas/storeFront/rewards.js";
import type * as schemas_storeFront_savedBag from "../schemas/storeFront/savedBag.js";
import type * as schemas_storeFront_savedBagItem from "../schemas/storeFront/savedBagItem.js";
import type * as schemas_storeFront_storeFrontSession from "../schemas/storeFront/storeFrontSession.js";
import type * as schemas_storeFront_storeFrontUser from "../schemas/storeFront/storeFrontUser.js";
import type * as schemas_storeFront_storeFrontVerificationCode from "../schemas/storeFront/storeFrontVerificationCode.js";
import type * as schemas_storeFront_supportTicket from "../schemas/storeFront/supportTicket.js";
import type * as sendgrid_index from "../sendgrid/index.js";
import type * as storeFront_analytics from "../storeFront/analytics.js";
import type * as storeFront_auth from "../storeFront/auth.js";
import type * as storeFront_bag from "../storeFront/bag.js";
import type * as storeFront_bagItem from "../storeFront/bagItem.js";
import type * as storeFront_checkoutSession from "../storeFront/checkoutSession.js";
import type * as storeFront_customerBehaviorTimeline from "../storeFront/customerBehaviorTimeline.js";
import type * as storeFront_guest from "../storeFront/guest.js";
import type * as storeFront_offers from "../storeFront/offers.js";
import type * as storeFront_onlineOrder from "../storeFront/onlineOrder.js";
import type * as storeFront_onlineOrderItem from "../storeFront/onlineOrderItem.js";
import type * as storeFront_onlineOrderUtilFns from "../storeFront/onlineOrderUtilFns.js";
import type * as storeFront_payment from "../storeFront/payment.js";
import type * as storeFront_paystackActions from "../storeFront/paystackActions.js";
import type * as storeFront_reviews from "../storeFront/reviews.js";
import type * as storeFront_rewards from "../storeFront/rewards.js";
import type * as storeFront_savedBag from "../storeFront/savedBag.js";
import type * as storeFront_savedBagItem from "../storeFront/savedBagItem.js";
import type * as storeFront_supportTicket from "../storeFront/supportTicket.js";
import type * as storeFront_user from "../storeFront/user.js";
import type * as storeFront_userOffers from "../storeFront/userOffers.js";
import type * as utils from "../utils.js";

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
  "aws/aws": typeof aws_aws;
  "cache/index": typeof cache_index;
  "constants/countries": typeof constants_countries;
  "constants/ghana": typeof constants_ghana;
  crons: typeof crons;
  env: typeof env;
  "http/domains/inventory/routes/analytics": typeof http_domains_inventory_routes_analytics;
  "http/domains/inventory/routes/auth": typeof http_domains_inventory_routes_auth;
  "http/domains/inventory/routes/categories": typeof http_domains_inventory_routes_categories;
  "http/domains/inventory/routes/colors": typeof http_domains_inventory_routes_colors;
  "http/domains/inventory/routes/index": typeof http_domains_inventory_routes_index;
  "http/domains/inventory/routes/organizations": typeof http_domains_inventory_routes_organizations;
  "http/domains/inventory/routes/products": typeof http_domains_inventory_routes_products;
  "http/domains/inventory/routes/stores": typeof http_domains_inventory_routes_stores;
  "http/domains/inventory/routes/subcategories": typeof http_domains_inventory_routes_subcategories;
  "http/domains/storeFront/routes/bag": typeof http_domains_storeFront_routes_bag;
  "http/domains/storeFront/routes/checkout": typeof http_domains_storeFront_routes_checkout;
  "http/domains/storeFront/routes/guest": typeof http_domains_storeFront_routes_guest;
  "http/domains/storeFront/routes/index": typeof http_domains_storeFront_routes_index;
  "http/domains/storeFront/routes/me": typeof http_domains_storeFront_routes_me;
  "http/domains/storeFront/routes/offers": typeof http_domains_storeFront_routes_offers;
  "http/domains/storeFront/routes/onlineOrder": typeof http_domains_storeFront_routes_onlineOrder;
  "http/domains/storeFront/routes/paystack": typeof http_domains_storeFront_routes_paystack;
  "http/domains/storeFront/routes/reviews": typeof http_domains_storeFront_routes_reviews;
  "http/domains/storeFront/routes/rewards": typeof http_domains_storeFront_routes_rewards;
  "http/domains/storeFront/routes/savedBag": typeof http_domains_storeFront_routes_savedBag;
  "http/domains/storeFront/routes/storefront": typeof http_domains_storeFront_routes_storefront;
  "http/domains/storeFront/routes/upsells": typeof http_domains_storeFront_routes_upsells;
  "http/domains/storeFront/routes/user": typeof http_domains_storeFront_routes_user;
  "http/domains/storeFront/routes/userOffers": typeof http_domains_storeFront_routes_userOffers;
  "http/utils": typeof http_utils;
  http: typeof http;
  "inventory/athenaUser": typeof inventory_athenaUser;
  "inventory/auth": typeof inventory_auth;
  "inventory/bestSeller": typeof inventory_bestSeller;
  "inventory/categories": typeof inventory_categories;
  "inventory/colors": typeof inventory_colors;
  "inventory/complimentaryProduct": typeof inventory_complimentaryProduct;
  "inventory/featuredItem": typeof inventory_featuredItem;
  "inventory/inviteCode": typeof inventory_inviteCode;
  "inventory/organizationMembers": typeof inventory_organizationMembers;
  "inventory/organizations": typeof inventory_organizations;
  "inventory/pos": typeof inventory_pos;
  "inventory/posCustomers": typeof inventory_posCustomers;
  "inventory/posSessions": typeof inventory_posSessions;
  "inventory/productSku": typeof inventory_productSku;
  "inventory/productUtil": typeof inventory_productUtil;
  "inventory/products": typeof inventory_products;
  "inventory/promoCode": typeof inventory_promoCode;
  "inventory/stockValidation": typeof inventory_stockValidation;
  "inventory/stores": typeof inventory_stores;
  "inventory/subcategories": typeof inventory_subcategories;
  "inventory/utils": typeof inventory_utils;
  "llm/callLlmProvider": typeof llm_callLlmProvider;
  "llm/providers/anthropic": typeof llm_providers_anthropic;
  "llm/providers/openai": typeof llm_providers_openai;
  "llm/storeInsights": typeof llm_storeInsights;
  "llm/userInsights": typeof llm_userInsights;
  "llm/utils/analyticsUtils": typeof llm_utils_analyticsUtils;
  "otp/ResendOTP": typeof otp_ResendOTP;
  "otp/VerificationCodeEmail": typeof otp_VerificationCodeEmail;
  "paystack/index": typeof paystack_index;
  "schemas/inventory/appVerificationCode": typeof schemas_inventory_appVerificationCode;
  "schemas/inventory/athenaUser": typeof schemas_inventory_athenaUser;
  "schemas/inventory/bestSeller": typeof schemas_inventory_bestSeller;
  "schemas/inventory/category": typeof schemas_inventory_category;
  "schemas/inventory/color": typeof schemas_inventory_color;
  "schemas/inventory/complimentaryProduct": typeof schemas_inventory_complimentaryProduct;
  "schemas/inventory/featuredItem": typeof schemas_inventory_featuredItem;
  "schemas/inventory/index": typeof schemas_inventory_index;
  "schemas/inventory/inviteCode": typeof schemas_inventory_inviteCode;
  "schemas/inventory/organization": typeof schemas_inventory_organization;
  "schemas/inventory/organizationMember": typeof schemas_inventory_organizationMember;
  "schemas/inventory/product": typeof schemas_inventory_product;
  "schemas/inventory/promoCode": typeof schemas_inventory_promoCode;
  "schemas/inventory/redeemedPromoCode": typeof schemas_inventory_redeemedPromoCode;
  "schemas/inventory/store": typeof schemas_inventory_store;
  "schemas/inventory/subcategory": typeof schemas_inventory_subcategory;
  "schemas/pos/customer": typeof schemas_pos_customer;
  "schemas/pos/index": typeof schemas_pos_index;
  "schemas/pos/posSession": typeof schemas_pos_posSession;
  "schemas/pos/posTransaction": typeof schemas_pos_posTransaction;
  "schemas/pos/posTransactionItem": typeof schemas_pos_posTransactionItem;
  "schemas/storeFront/analytics": typeof schemas_storeFront_analytics;
  "schemas/storeFront/bag": typeof schemas_storeFront_bag;
  "schemas/storeFront/bagItem": typeof schemas_storeFront_bagItem;
  "schemas/storeFront/checkoutSession": typeof schemas_storeFront_checkoutSession;
  "schemas/storeFront/checkoutSessionItem": typeof schemas_storeFront_checkoutSessionItem;
  "schemas/storeFront/customer": typeof schemas_storeFront_customer;
  "schemas/storeFront/guest": typeof schemas_storeFront_guest;
  "schemas/storeFront/index": typeof schemas_storeFront_index;
  "schemas/storeFront/offer": typeof schemas_storeFront_offer;
  "schemas/storeFront/onlineOrder/onlineOrder": typeof schemas_storeFront_onlineOrder_onlineOrder;
  "schemas/storeFront/onlineOrder/onlineOrderItem": typeof schemas_storeFront_onlineOrder_onlineOrderItem;
  "schemas/storeFront/review": typeof schemas_storeFront_review;
  "schemas/storeFront/rewards": typeof schemas_storeFront_rewards;
  "schemas/storeFront/savedBag": typeof schemas_storeFront_savedBag;
  "schemas/storeFront/savedBagItem": typeof schemas_storeFront_savedBagItem;
  "schemas/storeFront/storeFrontSession": typeof schemas_storeFront_storeFrontSession;
  "schemas/storeFront/storeFrontUser": typeof schemas_storeFront_storeFrontUser;
  "schemas/storeFront/storeFrontVerificationCode": typeof schemas_storeFront_storeFrontVerificationCode;
  "schemas/storeFront/supportTicket": typeof schemas_storeFront_supportTicket;
  "sendgrid/index": typeof sendgrid_index;
  "storeFront/analytics": typeof storeFront_analytics;
  "storeFront/auth": typeof storeFront_auth;
  "storeFront/bag": typeof storeFront_bag;
  "storeFront/bagItem": typeof storeFront_bagItem;
  "storeFront/checkoutSession": typeof storeFront_checkoutSession;
  "storeFront/customerBehaviorTimeline": typeof storeFront_customerBehaviorTimeline;
  "storeFront/guest": typeof storeFront_guest;
  "storeFront/offers": typeof storeFront_offers;
  "storeFront/onlineOrder": typeof storeFront_onlineOrder;
  "storeFront/onlineOrderItem": typeof storeFront_onlineOrderItem;
  "storeFront/onlineOrderUtilFns": typeof storeFront_onlineOrderUtilFns;
  "storeFront/payment": typeof storeFront_payment;
  "storeFront/paystackActions": typeof storeFront_paystackActions;
  "storeFront/reviews": typeof storeFront_reviews;
  "storeFront/rewards": typeof storeFront_rewards;
  "storeFront/savedBag": typeof storeFront_savedBag;
  "storeFront/savedBagItem": typeof storeFront_savedBagItem;
  "storeFront/supportTicket": typeof storeFront_supportTicket;
  "storeFront/user": typeof storeFront_user;
  "storeFront/userOffers": typeof storeFront_userOffers;
  utils: typeof utils;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
