# Graph Report - .  (2026-04-09)

## Corpus Check
- 1203 files · ~0 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2282 nodes · 5098 edges · 72 communities detected
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 475 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `createJourneyEvent()` - 40 edges
2. `CodexAppServerClient` - 23 edges
3. `getStoreConfigV2()` - 16 edges
4. `toV2Config()` - 13 edges
5. `getBaseUrl()` - 12 edges
6. `resolveEffectiveConfig()` - 10 edges
7. `LinearTrackerClient` - 10 edges
8. `usePOSSessionManager()` - 9 edges
9. `getBaseUrl()` - 9 edges
10. `handleRequest()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `getAmountPaidForOrder()` --calls--> `getDiscountValue()`  [INFERRED]
  packages/athena-webapp/src/components/orders/utils.ts → packages/storefront-webapp/src/components/checkout/utils.ts
- `getProductName()` --calls--> `capitalizeWords()`  [INFERRED]
  packages/athena-webapp/convex/utils.ts → packages/storefront-webapp/src/lib/utils.ts
- `mapMtnMomoReceivingAccount()` --calls--> `asRecord()`  [INFERRED]
  packages/athena-webapp/src/lib/storeConfig.ts → packages/storefront-webapp/src/lib/storeConfig.ts
- `mapPromotion()` --calls--> `asRecord()`  [INFERRED]
  packages/athena-webapp/src/lib/storeConfig.ts → packages/storefront-webapp/src/lib/storeConfig.ts
- `normalizeWaiveDeliveryFees()` --calls--> `asRecord()`  [INFERRED]
  packages/athena-webapp/src/lib/storeConfig.ts → packages/storefront-webapp/src/lib/storeConfig.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (16): AnalyticsCombinedUsers(), processAnalyticsToUsers(), AnalyticsTopUsers(), processAnalyticsToUsers(), isSkuReserved(), shouldDisable(), handleFileSelect(), validateFile() (+8 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (15): getRemainingForFreeDelivery(), hasWaiverConfigured(), isAnyFeeWaived(), isFeeWaived(), meetsThreshold(), handleKeyDown(), handleRedeemPromoCode(), getPromoAlertCopy() (+7 more)

### Community 2 - "Community 2"
Cohesion: 0.01
Nodes (50): getAllCategories(), getAllCategoriesWithSubcategories(), getBaseUrl(), getCategory(), expectIndex(), getTableIndexes(), acquireInventoryHold(), acquireInventoryHoldsBatch() (+42 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (84): asObject(), parseCliArgs(), parsePortArg(), parseWorkflowServerPort(), runCli(), runCliEntry(), SymphonyError, handleRequest() (+76 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (17): handleNewSession(), resetAutoSessionInitialized(), Logger, handleNewSession(), resetAutoSessionInitialized(), usePOSActiveSession(), usePOSSessionComplete(), usePOSSessionCreate() (+9 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (12): getNonEmptyString(), isFailureStatus(), normalizeEvent(), handleSave(), hasReceivingAccountDetails(), normalizePrimaryAccounts(), toPatchReceivingAccounts(), trimToUndefined() (+4 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (12): createReview(), deleteReview(), getBaseUrl(), getReviewByOrderItem(), getReviewsByProductId(), getReviewsByProductSkuId(), getUserReviews(), getUserReviewsForProduct() (+4 more)

### Community 7 - "Community 7"
Cohesion: 0.03
Nodes (9): bufferToHex(), collectBrowserInfo(), generateBrowserFingerprint(), hashFingerprintSource(), modifyProduct(), onSubmit(), saveProduct(), onSubmit() (+1 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (26): buildApprovalResponse(), buildHeaders(), CodexAppServerClient, createCollectionsAccessToken(), encodeBasicAuth(), getRequestToPayStatus(), requestToPay(), toError() (+18 more)

### Community 9 - "Community 9"
Cohesion: 0.05
Nodes (39): getAllColors(), getBaseUrl(), asInt(), asObject(), asPositiveInt(), asString(), asStringArray(), buildMtnCollectionsLookupPrefixes() (+31 more)

### Community 10 - "Community 10"
Cohesion: 0.03
Nodes (4): cancelOrder(), getErrorMessage(), placeOrder(), ValkeyClient

### Community 11 - "Community 11"
Cohesion: 0.05
Nodes (31): checkIfItemsHaveChanged(), CheckoutSessionError, createCheckoutSession(), createOnlineOrder(), defaultCheckoutActionMessage(), findBestValuePromoCode(), getActiveCheckoutSession(), getBaseUrl() (+23 more)

### Community 12 - "Community 12"
Cohesion: 0.06
Nodes (29): onSubmit(), reportAuthFailure(), resendVerificationCode(), addItemToBag(), clearBag(), getActiveBag(), getBaseUrl(), listBagItems() (+21 more)

### Community 13 - "Community 13"
Cohesion: 0.04
Nodes (2): onSubmit(), saveStoreChanges()

### Community 14 - "Community 14"
Cohesion: 0.08
Nodes (45): compactContext(), createAuthEntryViewedEvent(), createAuthRequestStartedEvent(), createAuthVerificationSucceededEvent(), createAuthVerificationViewedEvent(), createBagAddSucceededEvent(), createBagMoveToSavedEvent(), createBagRemoveSucceededEvent() (+37 more)

### Community 15 - "Community 15"
Cohesion: 0.1
Nodes (28): asArray(), asBoolean(), asMtnMomoSetupStatus(), asNumber(), asOptionalArray(), asRecord(), assignOrDelete(), asString() (+20 more)

### Community 16 - "Community 16"
Cohesion: 0.1
Nodes (26): handleDeliveryRestrictionToggle(), handlePickupRestrictionToggle(), handleSaveDeliveryRestriction(), handleSavePickupRestriction(), saveDeliveryRestriction(), savePickupRestriction(), asBoolean(), asMtnMomoSetupStatus() (+18 more)

### Community 17 - "Community 17"
Cohesion: 0.07
Nodes (7): handleFileSelect(), handleRevert(), handleUpload(), resetEditState(), uploadImage(), validateFile(), MockImage

### Community 18 - "Community 18"
Cohesion: 0.11
Nodes (27): collectMarkdownLinkErrors(), collectReferencedPathErrors(), collectTestingDocErrors(), collectTestSurfaceRoots(), extractInlineCode(), extractTestScriptFromCommand(), fileExists(), isLikelyPathReference() (+19 more)

### Community 19 - "Community 19"
Cohesion: 0.17
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 0.18
Nodes (0): 

### Community 21 - "Community 21"
Cohesion: 0.22
Nodes (2): useBulkOperations(), validateOperationValue()

### Community 22 - "Community 22"
Cohesion: 0.2
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 0.24
Nodes (3): bootstrapCheckout(), createBootstrapToken(), createMarker()

### Community 24 - "Community 24"
Cohesion: 0.39
Nodes (7): calculateRefundAmount(), getAmountRefunded(), getAvailableItems(), getItemsToRefund(), getNetAmount(), shouldShowReturnToStock(), validateRefund()

### Community 25 - "Community 25"
Cohesion: 0.4
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 0.7
Nodes (4): runTests(), testBasicOperations(), testClusterInfo(), testConnection()

### Community 27 - "Community 27"
Cohesion: 0.67
Nodes (0): 

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (2): mockGetSku(), validateInventoryForTransaction()

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (0): 

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (0): 

### Community 38 - "Community 38"
Cohesion: 1.0
Nodes (0): 

### Community 39 - "Community 39"
Cohesion: 1.0
Nodes (0): 

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (0): 

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (0): 

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (0): 

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (0): 

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (0): 

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (0): 

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (0): 

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (0): 

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (0): 

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (0): 

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (0): 

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (0): 

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (0): 

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (0): 

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (0): 

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (0): 

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (0): 

### Community 57 - "Community 57"
Cohesion: 1.0
Nodes (0): 

### Community 58 - "Community 58"
Cohesion: 1.0
Nodes (0): 

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (0): 

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (0): 

### Community 61 - "Community 61"
Cohesion: 1.0
Nodes (0): 

### Community 62 - "Community 62"
Cohesion: 1.0
Nodes (0): 

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (0): 

### Community 64 - "Community 64"
Cohesion: 1.0
Nodes (0): 

### Community 65 - "Community 65"
Cohesion: 1.0
Nodes (0): 

### Community 66 - "Community 66"
Cohesion: 1.0
Nodes (0): 

### Community 67 - "Community 67"
Cohesion: 1.0
Nodes (0): 

### Community 68 - "Community 68"
Cohesion: 1.0
Nodes (0): 

### Community 69 - "Community 69"
Cohesion: 1.0
Nodes (0): 

### Community 70 - "Community 70"
Cohesion: 1.0
Nodes (0): 

### Community 71 - "Community 71"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **Thin community `Community 29`** (2 nodes): `routerComposition.test.ts`, `readProjectFile()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (2 nodes): `posQueryCleanup.test.ts`, `readProjectFile()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (2 nodes): `sessionQueryIndexes.test.ts`, `readProjectFile()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (2 nodes): `foundation.test.ts`, `readProjectFile()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (2 nodes): `helperOrchestration.test.ts`, `readProjectFile()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (2 nodes): `timeQueryRefactors.test.ts`, `readSource()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (2 nodes): `NoResultsMessage.tsx`, `NoResultsMessage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (2 nodes): `PrintInstructions.tsx`, `PrintInstructions()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (2 nodes): `SingleLineError.tsx`, `SingleLineError()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (2 nodes): `timeline-item.tsx`, `TimelineItem()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (2 nodes): `webp-image.tsx`, `WebpImage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (2 nodes): `NotificationPill.tsx`, `NotificationPill()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (2 nodes): `webp-jpg.tsx`, `WebpImage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (2 nodes): `FormSubmissionProvider.tsx`, `useFormSubmission()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (2 nodes): `architecture-boundaries.test.ts`, `createSnippetLinter()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (2 nodes): `architecture-boundary-check.ts`, `run()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (1 nodes): `auth.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (1 nodes): `appVerificationCode.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (1 nodes): `organizationMember.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (1 nodes): `redeemedPromoCode.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (1 nodes): `customer.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (1 nodes): `expenseSession.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (1 nodes): `expenseSessionItem.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (1 nodes): `expenseTransaction.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (1 nodes): `expenseTransactionItem.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (1 nodes): `posSessionItem.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (1 nodes): `posTransaction.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (1 nodes): `posTransactionItem.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (1 nodes): `checkoutSessionItem.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (1 nodes): `offer.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (1 nodes): `storeFrontSession.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (1 nodes): `storeFrontVerificationCode.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (1 nodes): `eslint.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (1 nodes): `postcss.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (1 nodes): `ThemeToggle.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (1 nodes): `collapsible.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (1 nodes): `ThemeContext.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (1 nodes): `aws.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (1 nodes): `setup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (1 nodes): `tailwind.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (1 nodes): `vitest.setup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (1 nodes): `global.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (1 nodes): `playwright.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Are the 39 inferred relationships involving `createJourneyEvent()` (e.g. with `compactContext()` and `createLandingPageViewedEvent()`) actually correct?**
  _`createJourneyEvent()` has 39 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `getStoreConfigV2()` (e.g. with `getRawConfig()` and `asRecord()`) actually correct?**
  _`getStoreConfigV2()` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `toV2Config()` (e.g. with `asRecord()` and `firstDefined()`) actually correct?**
  _`toV2Config()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `getBaseUrl()` (e.g. with `createReview()` and `getReviewByOrderItem()`) actually correct?**
  _`getBaseUrl()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._