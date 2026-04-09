# Graph Report - packages/athena-webapp  (2026-04-09)

## Corpus Check
- Large corpus: 832 files · ~265,424 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 1994 nodes · 3695 edges · 178 communities detected
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 286 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `Store Schema` - 16 edges
2. `PromoCodeView` - 15 edges
3. `Mailersend Email Module` - 14 edges
4. `toV2Config()` - 12 edges
5. `Checkout Routes Handler` - 12 edges
6. `getStoreDataFromRequest` - 12 edges
7. `getStoreConfigV2()` - 11 edges
8. `Checkout HTTP Routes` - 11 edges
9. `StoreFront Schema Index` - 11 edges
10. `getStorefrontUserFromRequest` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Banner Message Schema` --references--> `Store Schema`  [INFERRED]
  packages/athena-webapp/convex/schemas/inventory/bannerMessage.ts → packages/athena-webapp/convex/schemas/inventory/store.ts
- `Store Schema` --references--> `Organization Schema`  [INFERRED]
  packages/athena-webapp/convex/schemas/inventory/store.ts → packages/athena-webapp/convex/schemas/inventory/organization.ts
- `Collection Schema` --references--> `Store Schema`  [INFERRED]
  packages/athena-webapp/convex/schemas/inventory/collection.ts → packages/athena-webapp/convex/schemas/inventory/store.ts
- `Promo Code Schema` --references--> `Store Schema`  [INFERRED]
  packages/athena-webapp/convex/schemas/inventory/promoCode.ts → packages/athena-webapp/convex/schemas/inventory/store.ts
- `Discount Code Schema` --references--> `Store Schema`  [INFERRED]
  packages/athena-webapp/convex/schemas/inventory/discountCode.ts → packages/athena-webapp/convex/schemas/inventory/store.ts

## Hyperedges (group relationships)
- **Inventory Domain Schemas** — organizationMember_schema, bannerMessage_schema, athenaUser_schema, organization_schema, store_schema, product_schema, productSku_schema, expense_schema, posSession_schema, productCategory_schema, attribute_schema, subcategory_schema, category_schema, collection_schema, promoCode_schema, discountCode_schema, appConfig_schema, analyticsEvent_schema, webhookEvent_schema, review_schema, appMediaAsset_schema, supportTicket_schema [EXTRACTED 1.00]
- **Product Taxonomy Schemas** — product_schema, productSku_schema, productCategory_schema, category_schema, subcategory_schema, collection_schema, attribute_schema [INFERRED 0.90]
- **Organization Hierarchy Schemas** — organization_schema, store_schema, organizationMember_schema, athenaUser_schema [INFERRED 0.90]
- **Promotions and Discounts Schemas** — promoCode_schema, discountCode_schema [INFERRED 0.85]
- **Expense Session Lifecycle** — inventory_expenseSessions, inventory_expenseTransactions, inventory_helpers_inventoryHolds, inventory_helpers_expenseSessionValidation, inventory_helpers_expenseSessionExpiration, db_expenseSession, db_expenseSessionItem [EXTRACTED 0.95]
- **Product Catalog Core** — inventory_products, inventory_productSku, inventory_categories, inventory_subcategories, db_product, db_productSku, db_category, db_subcategory [INFERRED 0.90]
- **Organization Hierarchy** — inventory_organizations, inventory_organizationMembers, inventory_athenaUser, inventory_stores, db_organization, db_organizationMember, db_athenaUser, db_store [INFERRED 0.85]
- **Promo Code System** — inventory_promoCode, db_promoCode, db_promoCodeItem, db_redeemedPromoCode, storeFront_checkoutSession [EXTRACTED 0.90]
- **Email Notification Pipeline** — mailersend_module, orderEmailService_module, email_constants, payment_constants, newOrderAdmin_email, orderEmail_email [EXTRACTED 0.95]
- **POS Session Lifecycle Management** — posSessions_module, inventoryHolds_helpers, sessionValidation_helpers, sessionExpiration_helpers, pos_module, posSession_table, posSessionItem_table [EXTRACTED 0.95]
- **Paystack Payment Integration** — paystackService_module, paystackService_initializeTransaction, paystackService_verifyTransaction, paystackService_initiateRefund, payment_constants [EXTRACTED 0.95]
- **Promo Code Discount Subsystem** — promoCode_module, checkoutSession_storefront, promoCode_table, productSku_inventory [EXTRACTED 0.90]
- **shadcn/ui Primitive Components** — ui_alertdialog_AlertDialog, ui_alert_Alert, ui_avatar_Avatar, ui_badge_Badge, ui_button_Button, ui_calendar_Calendar, ui_card_Card, ui_carousel_Carousel, ui_chart_Chart, ui_checkbox_Checkbox, ui_collapsible_Collapsible, ui_command_Command, ui_dialog_Dialog, ui_drawer_Drawer, ui_dropdownmenu_DropdownMenu, ui_form_Form, ui_input_Input [INFERRED 0.95]
- **App Layout Components** — view_View, appsidebar_AppSidebar, storesaccordion_StoresAccordion, settingsview_SettingsView, errorboundary_ErrorBoundary [INFERRED 0.80]
- **Products Table UI Component Suite** — data_table_faceted_filter, data_table_pagination_products, data_table_row_actions_products, data_table_view_options_products, columns_products [INFERRED 0.90]
- **Discounts Table UI Component Suite** — discounts_data_table, columns_discounts, discounts_table_toolbar, discounts_table_pagination, discounts_table_row_actions, discounts_table_column_header, discounts_table_view_options [INFERRED 0.90]
- **Homepage Components Group** — hero_header, home_view, hero_header_image_uploader [INFERRED 0.85]
- **Discounts Feature Components** — discounts_view, discount_view, discount_form, discount_status_badge, discounts_data_table [INFERRED 0.85]
- **Collections Feature Components** — collections_view, collection_view, collection_form [INFERRED 0.85]
- **Payment Processing Pipeline** — payment_createTransaction, payment_verifyPayment, payment_autoVerifyUnverifiedPayments, paystackService_module, paymentHelpers_module, orderEmailService_module, rewards_awardOrderPoints [EXTRACTED 1.00]
- **Customer Analytics and Observability System** — analytics_module, customerBehaviorTimeline_module, customerObservabilityTimelineData_buildTimeline, customerObservabilityTimelineData_types, storefrontObservabilityReport_module, analyticsUtils_calculateDeviceDistribution, analyticsUtils_calculateActivityTrend [INFERRED 0.90]
- **Offer and Discount Email Flow** — offers_module, offers_sendOfferEmail, offers_sendOfferReminderEmail, mailersend_module, userOffers_getEligibility [EXTRACTED 1.00]
- **Order Lifecycle Email System** — onlineOrderUtilFns_sendOrderUpdateEmail, orderUpdateEmails_processOrderUpdateEmail, orderUpdateEmails_formatOrderItems, mailersend_module, orderEmailService_module [EXTRACTED 1.00]
- **Checkout to Order Creation Flow** — checkoutsession_create, checkoutsession_updatecheckoutsession, helpers_onlineorder, onlineorder_create [EXTRACTED 0.95]
- **Order Email Notification Pipeline** — orderemailservice_module, mailersend_sendorderemails, mailersend_sendneworderemails, constants_email [EXTRACTED 0.95]
- **Promo Code Auto-Apply System** — checkoutsession_create, checkoutsession_findbestvaluepromocode, checkoutsession_validateexistingdiscount, inventory_promocode [EXTRACTED 0.90]
- **First-Review Offer Creation Flow** — reviews_create, inventory_promocode, mailersend_sendfeedbackrequestemail [EXTRACTED 0.90]
- **Transactional Email Templates** — emails_PosReceiptEmail, emails_DiscountReminder, emails_DiscountCode, emails_NewOrderAdmin, emails_OrderEmail [INFERRED 0.90]
- **StoreFront HTTP Route Handlers** — routes_bag, routes_checkout, routes_reviews, routes_guest, routes_index [EXTRACTED 1.00]
- **Checkout Flow (Routes + Session + Payment)** — routes_checkout, storefront_checkoutSession, storefront_payment, storefront_bag, inventory_storeConfigV2 [INFERRED 0.85]
- **Discount Email Pair (Code + Reminder)** — emails_DiscountCode, emails_DiscountReminder [INFERRED 0.80]
- **Checkout Flow Schemas** — bag_bagSchema, checkoutSession_checkoutSessionSchema, onlineOrder_onlineOrderSchema, checkoutSession_paymentMethodSchema [INFERRED 0.90]
- **Order Item Data Schemas** — bagItem_bagItemSchema, savedBagItem_savedBagItemSchema, onlineOrderItem_onlineOrderItemSchema [INFERRED 0.85]
- **Order Review Lifecycle** — onlineOrder_onlineOrderSchema, onlineOrderItem_onlineOrderItemSchema, review_reviewSchema [INFERRED 0.85]
- **Convex Server-Side Function Builders** — convex_server_query, convex_server_mutation, convex_server_action, convex_server_httpaction [EXTRACTED 1.00]
- **Athena React Provider-Context Pattern** — provider_cart, provider_checkout, provider_theme, provider_store, provider_organization, provider_app, provider_product, provider_customer, provider_inventory, context_cart, context_checkout, context_theme, context_store, context_organization, context_app, context_product, context_customer [INFERRED 0.80]
- **Coverage Report UI Scripts** — coverage_block_navigation, coverage_sorter, coverage_prettify [INFERRED 0.85]
- **POS Inventory Validation Test Suite** — pos_backend_test, pos_simple_test, pos_inventory_validation_test, pos_sku_quantity_aggregation, pos_inventory_validation_logic [INFERRED 0.95]
- **POS Transaction Processing Flow** — pos_backend_test, pos_transaction_record, pos_transaction_item_record, pos_session_complete, pos_transaction_number_gen [INFERRED 0.90]
- **Library Utils Exported Functions** — lib_utils, lib_utils_cn, lib_utils_currencyFormatter, lib_utils_getRelativeTime, lib_utils_formatUserId [EXTRACTED 1.00]

## Communities

### Community 0 - "Admin UI Components"
Cohesion: 0.02
Nodes (4): Products Table Columns Definition, DataTableRowActions Component (Products), handleNewSession(), resetAutoSessionInitialized()

### Community 1 - "Product Management UI"
Cohesion: 0.02
Nodes (13): buildUsername(), normalizeNameSegment(), handleDeliveryRestrictionToggle(), handlePickupRestrictionToggle(), handleSaveDeliveryRestriction(), handleSavePickupRestriction(), saveDeliveryRestriction(), savePickupRestriction() (+5 more)

### Community 2 - "Cart & Calculations"
Cohesion: 0.02
Nodes (14): handleNewSession(), resetAutoSessionInitialized(), usePOSActiveSession(), usePOSSessionComplete(), usePOSSessionCreate(), usePOSSessionHold(), usePOSSessionManager(), usePOSSessionResume() (+6 more)

### Community 3 - "Analytics & LLM Integration"
Cohesion: 0.02
Nodes (10): listBagItems(), loadBagWithItems(), expectIndex(), getTableIndexes(), createOffer(), isDuplicate(), updateStoreFrontActorEmail(), clearBagItems() (+2 more)

### Community 4 - "Analytics Data Views"
Cohesion: 0.03
Nodes (11): AnalyticsCombinedUsers(), processAnalyticsToUsers(), AnalyticsTopUsers(), processAnalyticsToUsers(), capitalizeWords(), countGroupedAnalytics(), getAmountPaidForOrder(), getDiscountValue() (+3 more)

### Community 5 - "Layout & Auth Shell"
Cohesion: 0.04
Nodes (4): bufferToHex(), collectBrowserInfo(), generateBrowserFingerprint(), hashFingerprintSource()

### Community 6 - "Customer Activity & Behavior"
Cohesion: 0.03
Nodes (7): getNonEmptyString(), isFailureStatus(), normalizeEvent(), getRiskStyles(), RiskIndicators(), getNonEmptyString(), normalizeStorefrontObservabilityEvent()

### Community 7 - "Checkout & Email Constants"
Cohesion: 0.04
Nodes (55): Checkout Session (Storefront), Email Constants (ADMIN_EMAILS, TEST_EMAIL_ACCOUNTS), Currency Library, Discount Code Email Component, Discount Reminder Email Component, Email Constants, Feedback Request Email Component, Inventory Utils (+47 more)

### Community 8 - "Analytics Component Layer"
Cohesion: 0.03
Nodes (71): AddProductCommand, analyticsColumns, AnalyticsProducts, ActiveCheckoutSessions, AnalyticsView, StoreVisitors, CapturedEmails, CategorySubcategoryManager (+63 more)

### Community 9 - "Convex Analytics Queries"
Cohesion: 0.04
Nodes (3): modifyProduct(), onSubmit(), saveProduct()

### Community 10 - "Database Schema & Storage"
Cohesion: 0.04
Nodes (65): Cloudflare R2, athenaUser Table, bannerMessage Table, category Table, checkoutSession Table, expenseSession Table, expenseSessionItem Table, organization Table (+57 more)

### Community 11 - "Media & Context Menus"
Cohesion: 0.05
Nodes (21): handleFileSelect(), handleRevert(), handleUpload(), resetEditState(), uploadImage(), validateFile(), MockImage, handleFileSelect() (+13 more)

### Community 12 - "Checkout Session Logic"
Cohesion: 0.06
Nodes (40): checkIfItemsHaveChanged(), CheckoutSession create Mutation, createOnlineOrder(), findBestValuePromoCode(), handleExistingSession(), handleOrderCreation(), handlePlaceOrder(), listSessionItems() (+32 more)

### Community 13 - "POS & Inventory Holds"
Cohesion: 0.06
Nodes (21): acquireInventoryHold(), acquireInventoryHoldsBatch(), adjustInventoryHold(), releaseInventoryHold(), validateInventoryAvailability(), collectAllPages(), createTransactionFromSessionHandler(), listCompletedTransactionsForDay() (+13 more)

### Community 14 - "Inventory API Layer"
Cohesion: 0.07
Nodes (46): inventory.bannerMessage (Convex), inventory.bestSeller (Convex), inventory.categories (Convex), inventory.featuredItem (Convex), inventory.productSku (Convex), inventory.productUtil (Convex), inventory.products (Convex), inventory.promoCode (Convex) (+38 more)

### Community 15 - "Order Activity & Modals"
Cohesion: 0.06
Nodes (7): calculateRefundAmount(), getAmountRefunded(), getAvailableItems(), getItemsToRefund(), getNetAmount(), shouldShowReturnToStock(), validateRefund()

### Community 16 - "Barcode & Image Utilities"
Cohesion: 0.05
Nodes (2): isSkuReserved(), shouldDisable()

### Community 17 - "Order & Payment Data"
Cohesion: 0.06
Nodes (36): DataTablePagination (base), api.storeFront.onlineOrder.getAllOnlineOrders, api.storeFront.onlineOrder.update, api.storeFront.payment.refundPayment, api.storeFront.payment.verifyPayment, OnlineOrderProvider, useOnlineOrder, useGetActiveStore (+28 more)

### Community 18 - "Convex Schema Definitions"
Cohesion: 0.13
Nodes (22): Analytics Event Schema, App Config Schema, App Media Asset Schema, Athena User Schema, Attribute Schema, Banner Message Schema, Category Schema, Collection Schema (+14 more)

### Community 19 - "Sheet UI Components"
Cohesion: 0.1
Nodes (20): Sheet, SheetContent, SheetDescription, SheetHeader, SheetOverlay, SheetPortal, SheetTitle, sheetVariants (CVA) (+12 more)

### Community 20 - "Validation Schemas"
Cohesion: 0.25
Nodes (16): Bag Item Schema, Bag Schema, Checkout Session Schema, Payment Method Schema, Customer Schema, Offer Schema, Online Order Item Schema, Address Schema (+8 more)

### Community 21 - "Utilities & Test Helpers"
Cohesion: 0.17
Nodes (16): Convex DB Mock Context, Utility Functions Library, cn Class Merge Utility, currencyFormatter Utility, formatUserId Utility, getRelativeTime Utility, POS Backend Tests, POS Cart Item Management (+8 more)

### Community 22 - "Customer Timeline UI"
Cohesion: 0.14
Nodes (15): ActivitySummaryCards, BagDetails, BagItemView, CustomerBehaviorTimeline, LinkedAccounts, TimelineEventCard, TimelineEventList, UserActivity (+7 more)

### Community 23 - "Table Sort Utilities"
Cohesion: 0.27
Nodes (11): addSortIndicators(), enableUI(), getNthColumn(), getTable(), getTableBody(), getTableHeader(), loadColumns(), loadData() (+3 more)

### Community 24 - "Code Prettification"
Cohesion: 0.35
Nodes (8): a(), B(), D(), g(), i(), k(), Q(), y()

### Community 25 - "POS Backend Tests"
Cohesion: 0.18
Nodes (0): 

### Community 26 - "Discounts Management"
Cohesion: 0.22
Nodes (11): Discounts Table Columns Definition, DiscountForm Component, DiscountStatusBadge Component, DiscountView Component, Discounts DataTable Component, Discounts Table ColumnHeader Component, Discounts Table Pagination Component, Discounts Table RowActions Component (+3 more)

### Community 27 - "Storefront Analytics"
Cohesion: 0.18
Nodes (11): calculateActivityTrend, calculateDeviceDistribution, analytics.getStorefrontObservabilityReport, analytics Module, customerBehaviorTimeline Module, CustomerObservabilityTimeline Types, guest.getReturningVisitorsForDay, offers Module (+3 more)

### Community 28 - "POS Simple Tests"
Cohesion: 0.2
Nodes (0): 

### Community 29 - "POS Cashier Interface"
Cohesion: 0.22
Nodes (9): CashierView, api.inventory.cashier.getById, useExpenseStore, usePOSStore, useExpenseActiveSession, usePOSOperations, usePOSActiveSession, useSessionManagementExpense (+1 more)

### Community 30 - "Module Cluster 30"
Cohesion: 0.54
Nodes (1): Logger

### Community 31 - "Module Cluster 31"
Cohesion: 0.25
Nodes (8): Inventory Holds Helpers, POS Session Item (DB Table), POS Session (DB Table), POS Sessions Module, POS Module, Result Types Helpers, Session Expiration Helpers, Session Validation Helpers

### Community 32 - "Module Cluster 32"
Cohesion: 0.29
Nodes (7): SettingsView, AlertDialog, Button, Calendar, Card, Chart, Input

### Community 33 - "Module Cluster 33"
Cohesion: 0.29
Nodes (7): Convex anyApi Reference Utility, Convex Generated API Utility, Convex Generated Server Utilities, Convex Action Function Builder, Convex HTTP Action Function Builder, Convex Mutation Function Builder, Convex Query Function Builder

### Community 34 - "Module Cluster 34"
Cohesion: 0.29
Nodes (7): NotFoundView Component, OrdersView Component, ProductsView Component, StoreProductsView Component, Organization Settings Route, Store Orders Index Route, Store Products Index Route

### Community 35 - "Module Cluster 35"
Cohesion: 0.4
Nodes (6): AppSidebar, StoresAccordion, Avatar, Badge, Collapsible, DropdownMenu

### Community 36 - "Module Cluster 36"
Cohesion: 0.33
Nodes (6): CheckoutSession cancelOrder Action, CheckoutSession Module, OnlineOrder Module, Reviews Module, SupportTicket Create Mutation, StoreFront User Module

### Community 37 - "Module Cluster 37"
Cohesion: 0.33
Nodes (6): App Context (missing), Organization Context (missing), Store Context (missing), App Provider (missing), Organization Provider (missing), Store Provider (missing)

### Community 38 - "Module Cluster 38"
Cohesion: 0.7
Nodes (4): getPaystackHeaders(), initializeTransaction(), initiateRefund(), verifyTransaction()

### Community 39 - "Module Cluster 39"
Cohesion: 0.7
Nodes (4): goToNext(), goToPrevious(), makeCurrent(), toggleClass()

### Community 40 - "Module Cluster 40"
Cohesion: 0.4
Nodes (5): api.inventory.auth.sendVerificationCodeViaProvider, api.inventory.auth.verifyCode, InputOTPForm, Login, LoginForm

### Community 41 - "Module Cluster 41"
Cohesion: 0.4
Nodes (5): Toggle, ToggleGroup, ToggleGroupContext, ToggleGroupItem, toggleVariants (CVA)

### Community 42 - "Module Cluster 42"
Cohesion: 0.5
Nodes (4): Invites DataTableToolbar, InviteDataTable, Invites Table Constants, MembersDataTable

### Community 43 - "Module Cluster 43"
Cohesion: 0.67
Nodes (4): BagItemsView, Bags, BagsTable, Bag Columns

### Community 44 - "Module Cluster 44"
Cohesion: 1.0
Nodes (2): mockGetSku(), validateInventoryForTransaction()

### Community 45 - "Module Cluster 45"
Cohesion: 0.67
Nodes (3): Command, Dialog, Drawer

### Community 46 - "Module Cluster 46"
Cohesion: 0.67
Nodes (3): HeroHeader Component, HeroHeaderImageUploader Component, HomeView Component

### Community 47 - "Module Cluster 47"
Cohesion: 0.67
Nodes (3): CollectionForm Component, CollectionView Component, CollectionsView Component

### Community 48 - "Module Cluster 48"
Cohesion: 0.67
Nodes (3): Coverage Block Navigation Script, Coverage Prettify Script, Coverage Table Sorter Script

### Community 49 - "Module Cluster 49"
Cohesion: 0.67
Nodes (3): BagItems, BagItem Columns, BagItemsTable

### Community 50 - "Module Cluster 50"
Cohesion: 0.67
Nodes (3): RadioGroup, RadioGroupContext, RadioGroupItem

### Community 51 - "Module Cluster 51"
Cohesion: 0.67
Nodes (3): SelectContent, SelectScrollDownButton, SelectScrollUpButton

### Community 52 - "Module Cluster 52"
Cohesion: 1.0
Nodes (0): 

### Community 53 - "Module Cluster 53"
Cohesion: 1.0
Nodes (0): 

### Community 54 - "Module Cluster 54"
Cohesion: 1.0
Nodes (0): 

### Community 55 - "Module Cluster 55"
Cohesion: 1.0
Nodes (0): 

### Community 56 - "Module Cluster 56"
Cohesion: 1.0
Nodes (0): 

### Community 57 - "Module Cluster 57"
Cohesion: 1.0
Nodes (0): 

### Community 58 - "Module Cluster 58"
Cohesion: 1.0
Nodes (0): 

### Community 59 - "Module Cluster 59"
Cohesion: 1.0
Nodes (0): 

### Community 60 - "Module Cluster 60"
Cohesion: 1.0
Nodes (0): 

### Community 61 - "Module Cluster 61"
Cohesion: 1.0
Nodes (0): 

### Community 62 - "Module Cluster 62"
Cohesion: 1.0
Nodes (0): 

### Community 63 - "Module Cluster 63"
Cohesion: 1.0
Nodes (2): ErrorBoundary, View

### Community 64 - "Module Cluster 64"
Cohesion: 1.0
Nodes (2): DataTablePagination Component (Products), DataTableViewOptions Component (Products)

### Community 65 - "Module Cluster 65"
Cohesion: 1.0
Nodes (2): bagItem Module, savedBag Module

### Community 66 - "Module Cluster 66"
Cohesion: 1.0
Nodes (2): guest Module, savedBag.updateOwner

### Community 67 - "Module Cluster 67"
Cohesion: 1.0
Nodes (2): customerBehaviorTimeline.getCustomerObservabilityTimeline, buildCustomerObservabilityTimeline

### Community 68 - "Module Cluster 68"
Cohesion: 1.0
Nodes (2): MailerSend sendFeedbackRequestEmail, Reviews sendFeedbackRequest Action

### Community 69 - "Module Cluster 69"
Cohesion: 1.0
Nodes (2): Product Context (missing), Product Provider (missing)

### Community 70 - "Module Cluster 70"
Cohesion: 1.0
Nodes (2): Customer Context (missing), Customer Provider (missing)

### Community 71 - "Module Cluster 71"
Cohesion: 1.0
Nodes (2): Cart Context (missing), Cart Provider (missing)

### Community 72 - "Module Cluster 72"
Cohesion: 1.0
Nodes (2): Checkout Context (missing), Checkout Provider (missing)

### Community 73 - "Module Cluster 73"
Cohesion: 1.0
Nodes (2): Theme Context (missing), Theme Provider (missing)

### Community 74 - "Module Cluster 74"
Cohesion: 1.0
Nodes (2): usePrint Hook, usePrint Hook Tests

### Community 75 - "Module Cluster 75"
Cohesion: 1.0
Nodes (2): AddComplimentaryProduct Component, New Complimentary Product Route

### Community 76 - "Module Cluster 76"
Cohesion: 1.0
Nodes (2): ProductDetailView Component, Product Detail Route

### Community 77 - "Module Cluster 77"
Cohesion: 1.0
Nodes (2): OrderView Component, Order Detail Route

### Community 78 - "Module Cluster 78"
Cohesion: 1.0
Nodes (2): ReviewsView Component, Store Reviews Index Route

### Community 79 - "Module Cluster 79"
Cohesion: 1.0
Nodes (2): PromoCodesDataTable, User Bags Table Toolbar

### Community 80 - "Module Cluster 80"
Cohesion: 1.0
Nodes (2): Icons (spinner dependency), Spinner

### Community 81 - "Module Cluster 81"
Cohesion: 1.0
Nodes (2): ScrollArea, ScrollBar

### Community 82 - "Module Cluster 82"
Cohesion: 1.0
Nodes (2): Separator, SidebarSeparator

### Community 83 - "Module Cluster 83"
Cohesion: 1.0
Nodes (2): SidebarContent, SidebarInput

### Community 84 - "Module Cluster 84"
Cohesion: 1.0
Nodes (2): SidebarMenuSkeleton, Skeleton

### Community 85 - "Module Cluster 85"
Cohesion: 1.0
Nodes (1): ProductStatus

### Community 86 - "Module Cluster 86"
Cohesion: 1.0
Nodes (1): Toaster (Sonner)

### Community 87 - "Module Cluster 87"
Cohesion: 1.0
Nodes (0): 

### Community 88 - "Module Cluster 88"
Cohesion: 1.0
Nodes (0): 

### Community 89 - "Module Cluster 89"
Cohesion: 1.0
Nodes (0): 

### Community 90 - "Module Cluster 90"
Cohesion: 1.0
Nodes (0): 

### Community 91 - "Module Cluster 91"
Cohesion: 1.0
Nodes (0): 

### Community 92 - "Module Cluster 92"
Cohesion: 1.0
Nodes (0): 

### Community 93 - "Module Cluster 93"
Cohesion: 1.0
Nodes (0): 

### Community 94 - "Module Cluster 94"
Cohesion: 1.0
Nodes (0): 

### Community 95 - "Module Cluster 95"
Cohesion: 1.0
Nodes (0): 

### Community 96 - "Module Cluster 96"
Cohesion: 1.0
Nodes (0): 

### Community 97 - "Module Cluster 97"
Cohesion: 1.0
Nodes (0): 

### Community 98 - "Module Cluster 98"
Cohesion: 1.0
Nodes (0): 

### Community 99 - "Module Cluster 99"
Cohesion: 1.0
Nodes (0): 

### Community 100 - "Module Cluster 100"
Cohesion: 1.0
Nodes (0): 

### Community 101 - "Module Cluster 101"
Cohesion: 1.0
Nodes (0): 

### Community 102 - "Module Cluster 102"
Cohesion: 1.0
Nodes (0): 

### Community 103 - "Module Cluster 103"
Cohesion: 1.0
Nodes (0): 

### Community 104 - "Module Cluster 104"
Cohesion: 1.0
Nodes (0): 

### Community 105 - "Module Cluster 105"
Cohesion: 1.0
Nodes (0): 

### Community 106 - "Module Cluster 106"
Cohesion: 1.0
Nodes (0): 

### Community 107 - "Module Cluster 107"
Cohesion: 1.0
Nodes (0): 

### Community 108 - "Module Cluster 108"
Cohesion: 1.0
Nodes (0): 

### Community 109 - "Module Cluster 109"
Cohesion: 1.0
Nodes (0): 

### Community 110 - "Module Cluster 110"
Cohesion: 1.0
Nodes (0): 

### Community 111 - "Module Cluster 111"
Cohesion: 1.0
Nodes (0): 

### Community 112 - "Module Cluster 112"
Cohesion: 1.0
Nodes (0): 

### Community 113 - "Module Cluster 113"
Cohesion: 1.0
Nodes (0): 

### Community 114 - "Module Cluster 114"
Cohesion: 1.0
Nodes (0): 

### Community 115 - "Module Cluster 115"
Cohesion: 1.0
Nodes (0): 

### Community 116 - "Module Cluster 116"
Cohesion: 1.0
Nodes (0): 

### Community 117 - "Module Cluster 117"
Cohesion: 1.0
Nodes (0): 

### Community 118 - "Module Cluster 118"
Cohesion: 1.0
Nodes (1): Alert

### Community 119 - "Module Cluster 119"
Cohesion: 1.0
Nodes (1): Carousel

### Community 120 - "Module Cluster 120"
Cohesion: 1.0
Nodes (1): Checkbox

### Community 121 - "Module Cluster 121"
Cohesion: 1.0
Nodes (1): Form

### Community 122 - "Module Cluster 122"
Cohesion: 1.0
Nodes (1): analytics.getConsolidatedAnalytics

### Community 123 - "Module Cluster 123"
Cohesion: 1.0
Nodes (1): analytics.getEnhancedAnalytics

### Community 124 - "Module Cluster 124"
Cohesion: 1.0
Nodes (1): analytics.getStoreActivityTimeline

### Community 125 - "Module Cluster 125"
Cohesion: 1.0
Nodes (1): rewards Module

### Community 126 - "Module Cluster 126"
Cohesion: 1.0
Nodes (1): customerBehaviorTimeline.getCustomerBehaviorTimeline

### Community 127 - "Module Cluster 127"
Cohesion: 1.0
Nodes (1): StoreFront Users getByIds

### Community 128 - "Module Cluster 128"
Cohesion: 1.0
Nodes (1): CheckoutSession releaseCheckoutItems

### Community 129 - "Module Cluster 129"
Cohesion: 1.0
Nodes (1): MailerSend sendDiscountReminderEmail

### Community 130 - "Module Cluster 130"
Cohesion: 1.0
Nodes (1): Inventory Provider (missing)

### Community 131 - "Module Cluster 131"
Cohesion: 1.0
Nodes (1): AnalyticProduct Interface

### Community 132 - "Module Cluster 132"
Cohesion: 1.0
Nodes (1): getOrigin

### Community 133 - "Module Cluster 133"
Cohesion: 1.0
Nodes (1): BagView

### Community 134 - "Module Cluster 134"
Cohesion: 1.0
Nodes (1): User Bags Table Columns (PromoCode)

### Community 135 - "Module Cluster 135"
Cohesion: 1.0
Nodes (1): DataTableColumnHeader

### Community 136 - "Module Cluster 136"
Cohesion: 1.0
Nodes (1): Label

### Community 137 - "Module Cluster 137"
Cohesion: 1.0
Nodes (1): Popover

### Community 138 - "Module Cluster 138"
Cohesion: 1.0
Nodes (1): PopoverTrigger

### Community 139 - "Module Cluster 139"
Cohesion: 1.0
Nodes (1): PopoverContent

### Community 140 - "Module Cluster 140"
Cohesion: 1.0
Nodes (1): Select

### Community 141 - "Module Cluster 141"
Cohesion: 1.0
Nodes (1): SelectTrigger

### Community 142 - "Module Cluster 142"
Cohesion: 1.0
Nodes (1): SelectItem

### Community 143 - "Module Cluster 143"
Cohesion: 1.0
Nodes (1): SelectLabel

### Community 144 - "Module Cluster 144"
Cohesion: 1.0
Nodes (1): SelectSeparator

### Community 145 - "Module Cluster 145"
Cohesion: 1.0
Nodes (1): SelectGroup

### Community 146 - "Module Cluster 146"
Cohesion: 1.0
Nodes (1): SelectValue

### Community 147 - "Module Cluster 147"
Cohesion: 1.0
Nodes (1): SheetFooter

### Community 148 - "Module Cluster 148"
Cohesion: 1.0
Nodes (1): SheetTrigger

### Community 149 - "Module Cluster 149"
Cohesion: 1.0
Nodes (1): SheetClose

### Community 150 - "Module Cluster 150"
Cohesion: 1.0
Nodes (1): SidebarInset

### Community 151 - "Module Cluster 151"
Cohesion: 1.0
Nodes (1): SidebarHeader

### Community 152 - "Module Cluster 152"
Cohesion: 1.0
Nodes (1): SidebarFooter

### Community 153 - "Module Cluster 153"
Cohesion: 1.0
Nodes (1): SidebarGroup

### Community 154 - "Module Cluster 154"
Cohesion: 1.0
Nodes (1): SidebarGroupLabel

### Community 155 - "Module Cluster 155"
Cohesion: 1.0
Nodes (1): SidebarGroupAction

### Community 156 - "Module Cluster 156"
Cohesion: 1.0
Nodes (1): SidebarGroupContent

### Community 157 - "Module Cluster 157"
Cohesion: 1.0
Nodes (1): SidebarMenu

### Community 158 - "Module Cluster 158"
Cohesion: 1.0
Nodes (1): SidebarMenuItem

### Community 159 - "Module Cluster 159"
Cohesion: 1.0
Nodes (1): SidebarMenuAction

### Community 160 - "Module Cluster 160"
Cohesion: 1.0
Nodes (1): SidebarMenuBadge

### Community 161 - "Module Cluster 161"
Cohesion: 1.0
Nodes (1): SidebarMenuSub

### Community 162 - "Module Cluster 162"
Cohesion: 1.0
Nodes (1): SidebarMenuSubItem

### Community 163 - "Module Cluster 163"
Cohesion: 1.0
Nodes (1): SidebarMenuSubButton

### Community 164 - "Module Cluster 164"
Cohesion: 1.0
Nodes (1): Switch

### Community 165 - "Module Cluster 165"
Cohesion: 1.0
Nodes (1): Table

### Community 166 - "Module Cluster 166"
Cohesion: 1.0
Nodes (1): TableHeader

### Community 167 - "Module Cluster 167"
Cohesion: 1.0
Nodes (1): TableBody

### Community 168 - "Module Cluster 168"
Cohesion: 1.0
Nodes (1): TableRow

### Community 169 - "Module Cluster 169"
Cohesion: 1.0
Nodes (1): TableHead

### Community 170 - "Module Cluster 170"
Cohesion: 1.0
Nodes (1): TableCell

### Community 171 - "Module Cluster 171"
Cohesion: 1.0
Nodes (1): TableFooter

### Community 172 - "Module Cluster 172"
Cohesion: 1.0
Nodes (1): TableCaption

### Community 173 - "Module Cluster 173"
Cohesion: 1.0
Nodes (1): Tabs

### Community 174 - "Module Cluster 174"
Cohesion: 1.0
Nodes (1): TabsList

### Community 175 - "Module Cluster 175"
Cohesion: 1.0
Nodes (1): TabsTrigger

### Community 176 - "Module Cluster 176"
Cohesion: 1.0
Nodes (1): TabsContent

### Community 177 - "Module Cluster 177"
Cohesion: 1.0
Nodes (1): Textarea

## Knowledge Gaps
- **338 isolated node(s):** `Banner Message Schema`, `Expense Schema`, `App Config Schema`, `Webhook Event Schema`, `App Media Asset Schema` (+333 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Module Cluster 52`** (2 nodes): `timeQueryRefactors.test.ts`, `readSource()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 53`** (2 nodes): `helperOrchestration.test.ts`, `readProjectFile()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 54`** (2 nodes): `routerComposition.test.ts`, `readProjectFile()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 55`** (2 nodes): `posQueryCleanup.test.ts`, `readProjectFile()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 56`** (2 nodes): `sessionQueryIndexes.test.ts`, `readProjectFile()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 57`** (2 nodes): `webp-image.tsx`, `WebpImage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 58`** (2 nodes): `timeline-item.tsx`, `TimelineItem()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 59`** (2 nodes): `PrintInstructions.tsx`, `PrintInstructions()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 60`** (2 nodes): `NoResultsMessage.tsx`, `NoResultsMessage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 61`** (2 nodes): `SingleLineError.tsx`, `SingleLineError()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 62`** (2 nodes): `maintenanceUtils.ts`, `isInMaintenanceMode()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 63`** (2 nodes): `ErrorBoundary`, `View`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 64`** (2 nodes): `DataTablePagination Component (Products)`, `DataTableViewOptions Component (Products)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 65`** (2 nodes): `bagItem Module`, `savedBag Module`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 66`** (2 nodes): `guest Module`, `savedBag.updateOwner`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 67`** (2 nodes): `customerBehaviorTimeline.getCustomerObservabilityTimeline`, `buildCustomerObservabilityTimeline`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 68`** (2 nodes): `MailerSend sendFeedbackRequestEmail`, `Reviews sendFeedbackRequest Action`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 69`** (2 nodes): `Product Context (missing)`, `Product Provider (missing)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 70`** (2 nodes): `Customer Context (missing)`, `Customer Provider (missing)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 71`** (2 nodes): `Cart Context (missing)`, `Cart Provider (missing)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 72`** (2 nodes): `Checkout Context (missing)`, `Checkout Provider (missing)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 73`** (2 nodes): `Theme Context (missing)`, `Theme Provider (missing)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 74`** (2 nodes): `usePrint Hook`, `usePrint Hook Tests`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 75`** (2 nodes): `AddComplimentaryProduct Component`, `New Complimentary Product Route`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 76`** (2 nodes): `ProductDetailView Component`, `Product Detail Route`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 77`** (2 nodes): `OrderView Component`, `Order Detail Route`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 78`** (2 nodes): `ReviewsView Component`, `Store Reviews Index Route`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 79`** (2 nodes): `PromoCodesDataTable`, `User Bags Table Toolbar`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 80`** (2 nodes): `Icons (spinner dependency)`, `Spinner`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 81`** (2 nodes): `ScrollArea`, `ScrollBar`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 82`** (2 nodes): `Separator`, `SidebarSeparator`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 83`** (2 nodes): `SidebarContent`, `SidebarInput`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 84`** (2 nodes): `SidebarMenuSkeleton`, `Skeleton`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 85`** (1 nodes): `ProductStatus`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 86`** (1 nodes): `Toaster (Sonner)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 87`** (1 nodes): `tailwind.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 88`** (1 nodes): `eslint.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 89`** (1 nodes): `postcss.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 90`** (1 nodes): `vitest.setup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 91`** (1 nodes): `auth.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 92`** (1 nodes): `customer.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 93`** (1 nodes): `checkoutSessionItem.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 94`** (1 nodes): `storeFrontVerificationCode.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 95`** (1 nodes): `review.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 96`** (1 nodes): `storeFrontUser.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 97`** (1 nodes): `storeFrontSession.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 98`** (1 nodes): `offer.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 99`** (1 nodes): `expenseTransaction.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 100`** (1 nodes): `expenseSession.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 101`** (1 nodes): `posTransaction.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 102`** (1 nodes): `expenseSessionItem.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 103`** (1 nodes): `posSessionItem.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 104`** (1 nodes): `posTransactionItem.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 105`** (1 nodes): `expenseTransactionItem.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 106`** (1 nodes): `category.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 107`** (1 nodes): `redeemedPromoCode.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 108`** (1 nodes): `organizationMember.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 109`** (1 nodes): `subcategory.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 110`** (1 nodes): `organization.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 111`** (1 nodes): `color.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 112`** (1 nodes): `appVerificationCode.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 113`** (1 nodes): `ThemeContext.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 114`** (1 nodes): `setup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 115`** (1 nodes): `ThemeToggle.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 116`** (1 nodes): `collapsible.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 117`** (1 nodes): `aws.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 118`** (1 nodes): `Alert`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 119`** (1 nodes): `Carousel`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 120`** (1 nodes): `Checkbox`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 121`** (1 nodes): `Form`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 122`** (1 nodes): `analytics.getConsolidatedAnalytics`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 123`** (1 nodes): `analytics.getEnhancedAnalytics`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 124`** (1 nodes): `analytics.getStoreActivityTimeline`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 125`** (1 nodes): `rewards Module`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 126`** (1 nodes): `customerBehaviorTimeline.getCustomerBehaviorTimeline`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 127`** (1 nodes): `StoreFront Users getByIds`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 128`** (1 nodes): `CheckoutSession releaseCheckoutItems`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 129`** (1 nodes): `MailerSend sendDiscountReminderEmail`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 130`** (1 nodes): `Inventory Provider (missing)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 131`** (1 nodes): `AnalyticProduct Interface`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 132`** (1 nodes): `getOrigin`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 133`** (1 nodes): `BagView`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 134`** (1 nodes): `User Bags Table Columns (PromoCode)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 135`** (1 nodes): `DataTableColumnHeader`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 136`** (1 nodes): `Label`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 137`** (1 nodes): `Popover`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 138`** (1 nodes): `PopoverTrigger`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 139`** (1 nodes): `PopoverContent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 140`** (1 nodes): `Select`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 141`** (1 nodes): `SelectTrigger`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 142`** (1 nodes): `SelectItem`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 143`** (1 nodes): `SelectLabel`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 144`** (1 nodes): `SelectSeparator`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 145`** (1 nodes): `SelectGroup`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 146`** (1 nodes): `SelectValue`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 147`** (1 nodes): `SheetFooter`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 148`** (1 nodes): `SheetTrigger`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 149`** (1 nodes): `SheetClose`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 150`** (1 nodes): `SidebarInset`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 151`** (1 nodes): `SidebarHeader`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 152`** (1 nodes): `SidebarFooter`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 153`** (1 nodes): `SidebarGroup`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 154`** (1 nodes): `SidebarGroupLabel`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 155`** (1 nodes): `SidebarGroupAction`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 156`** (1 nodes): `SidebarGroupContent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 157`** (1 nodes): `SidebarMenu`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 158`** (1 nodes): `SidebarMenuItem`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 159`** (1 nodes): `SidebarMenuAction`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 160`** (1 nodes): `SidebarMenuBadge`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 161`** (1 nodes): `SidebarMenuSub`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 162`** (1 nodes): `SidebarMenuSubItem`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 163`** (1 nodes): `SidebarMenuSubButton`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 164`** (1 nodes): `Switch`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 165`** (1 nodes): `Table`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 166`** (1 nodes): `TableHeader`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 167`** (1 nodes): `TableBody`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 168`** (1 nodes): `TableRow`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 169`** (1 nodes): `TableHead`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 170`** (1 nodes): `TableCell`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 171`** (1 nodes): `TableFooter`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 172`** (1 nodes): `TableCaption`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 173`** (1 nodes): `Tabs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 174`** (1 nodes): `TabsList`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 175`** (1 nodes): `TabsTrigger`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 176`** (1 nodes): `TabsContent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Module Cluster 177`** (1 nodes): `Textarea`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Are the 16 inferred relationships involving `Store Schema` (e.g. with `Organization Schema` and `Product Schema`) actually correct?**
  _`Store Schema` has 16 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `toV2Config()` (e.g. with `asRecord()` and `firstDefined()`) actually correct?**
  _`toV2Config()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `Checkout Routes Handler` (e.g. with `Paystack Webhook Routes Handler` and `Bag Routes Handler`) actually correct?**
  _`Checkout Routes Handler` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Banner Message Schema`, `Expense Schema`, `App Config Schema` to the rest of the system?**
  _338 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Admin UI Components` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Product Management UI` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Cart & Calculations` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._