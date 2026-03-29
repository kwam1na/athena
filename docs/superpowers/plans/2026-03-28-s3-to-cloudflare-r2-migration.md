# S3 to Cloudflare R2 Image Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace AWS S3 with Cloudflare R2 for all image storage (uploads, deletes, listing) and migrate existing images, completing the AWS decommissioning effort.

**Architecture:** The `@aws-sdk/client-s3` SDK is S3-compatible with R2 — same commands, different endpoint/credentials. We create a new `convex/cloudflare/r2.ts` module with the R2 config, update all imports, rewrite hardcoded S3 URLs, then run a one-time migration script to copy objects and update database URLs. The existing path structure (`stores/{storeId}/products/{productId}/{uuid}.webp`) stays the same.

**Tech Stack:** `@aws-sdk/client-s3` (reused — R2 is S3-compatible), Convex actions/mutations, `rclone` for bulk object copy

**Key context:**
- R2 bucket name: `athena-images`
- R2 endpoint: `https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com`
- Public URL: `https://images.wigclub.store`
- Old S3 URL pattern: `https://athena-amzn-bucket.s3.eu-west-1.amazonaws.com/{key}`
- New R2 URL pattern: `https://images.wigclub.store/{key}`

---

### Task 1: Create the R2 storage module

**Files:**
- Create: `packages/athena-webapp/convex/cloudflare/r2.ts`
- Reference: `packages/athena-webapp/convex/aws/aws.ts` (existing S3 module to mirror)

- [ ] **Step 1: Create `convex/cloudflare/r2.ts` with R2 client and all storage functions**

```typescript
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET!;
const PUBLIC_URL = process.env.R2_PUBLIC_URL!; // https://images.wigclub.store

export const uploadFileToR2 = async (file: any, key: string) => {
  try {
    const params = {
      Bucket: BUCKET,
      Key: key,
      Body: file,
    };

    await r2.send(new PutObjectCommand(params));
    return `${PUBLIC_URL}/${key}`;
  } catch (error) {
    // handled
  }
};

export const deleteFileInR2 = async (path: string) => {
  const OLD_S3_PREFIX = "https://athena-amzn-bucket.s3.eu-west-1.amazonaws.com/";
  let key = path.split(`${PUBLIC_URL}/`)[1];
  // Fallback: handle legacy S3 URLs during transition period
  if (!key) key = path.split(OLD_S3_PREFIX)[1];

  if (!key) return;

  try {
    const params = {
      Bucket: BUCKET,
      Key: key,
    };

    await r2.send(new DeleteObjectCommand(params));
    return { success: true, key };
  } catch (error) {
    // handled
  }
};

export const deleteDirectoryInR2 = async (directory: string) => {
  try {
    let continuationToken: string | undefined;

    do {
      const listParams = {
        Bucket: BUCKET,
        Prefix: `${directory}/`,
        ContinuationToken: continuationToken,
      };

      const listResponse = await r2.send(new ListObjectsV2Command(listParams));

      if (listResponse.Contents && listResponse.Contents.length > 0) {
        const deleteParams = {
          Bucket: BUCKET,
          Delete: {
            Objects: listResponse.Contents.map(({ Key }) => ({ Key })),
          },
        };

        await r2.send(new DeleteObjectsCommand(deleteParams));
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    const dirParams = {
      Bucket: BUCKET,
      Key: `${directory}/`,
    };
    await r2.send(new DeleteObjectCommand(dirParams));

    return { success: true, directory };
  } catch (error) {
    return { success: false, error, directory };
  }
};

export interface ListItemsOptions {
  directory: string;
  firstLevelOnly?: boolean;
}

export const listItemsInR2Directory = async ({
  directory,
  firstLevelOnly = false,
}: ListItemsOptions) => {
  try {
    const items: Array<{
      key: string;
      url: string;
      size?: number;
      type: string;
    }> = [];
    let continuationToken: string | undefined;

    do {
      const listParams = {
        Bucket: BUCKET,
        Prefix: `${directory}/`,
        Delimiter: firstLevelOnly ? "/" : undefined,
        ContinuationToken: continuationToken,
      };

      const listResponse = await r2.send(new ListObjectsV2Command(listParams));

      if (listResponse.Contents && listResponse.Contents.length > 0) {
        for (const item of listResponse.Contents) {
          if (item.Key) {
            if (firstLevelOnly && item.Key === `${directory}/`) continue;

            items.push({
              key: item.Key,
              url: `${PUBLIC_URL}/${item.Key}`,
              size: item.Size,
              type: "file",
            });
          }
        }
      }

      if (firstLevelOnly && listResponse.CommonPrefixes) {
        for (const prefix of listResponse.CommonPrefixes) {
          if (prefix.Prefix) {
            items.push({
              key: prefix.Prefix,
              url: `${PUBLIC_URL}/${prefix.Prefix}`,
              type: "directory",
            });
          }
        }
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    return { success: true, items, directory };
  } catch (error) {
    return { success: false, error, directory };
  }
};
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/kwamina/athena/packages/athena-webapp && npx tsc --noEmit convex/cloudflare/r2.ts 2>&1 | head -20`

Expected: No errors (or only Convex-related type issues that resolve at deploy time)

- [ ] **Step 3: Commit**

```bash
git add packages/athena-webapp/convex/cloudflare/r2.ts
git commit -m "feat: add Cloudflare R2 storage module"
```

---

### Task 2: Set Convex environment variables

**Manual step — not code. Must be done BEFORE deploying code changes.**

- [ ] **Step 1: Set env vars on Convex production dashboard**

Go to the Convex dashboard for the `colorless-cardinal-870` deployment and add:

| Variable | Value |
|----------|-------|
| `CLOUDFLARE_ACCOUNT_ID` | *(your Cloudflare account ID)* |
| `R2_ACCESS_KEY_ID` | *(from the R2 API token you created)* |
| `R2_SECRET_ACCESS_KEY` | *(from the R2 API token you created)* |
| `R2_BUCKET` | `athena-images` |
| `R2_PUBLIC_URL` | `https://images.wigclub.store` |

- [ ] **Step 2: Set env vars on Convex dev dashboard**

Same variables on the `jovial-wildebeest-179` deployment.

- [ ] **Step 3: Remove old AWS env vars (after migration is verified)**

Remove `AWS_REGION`, `AWS_ACCESS`, `AWS_SECRET`, `AWS_BUCKET` from both deployments. **Do this only after Task 7 verification is complete.**

---

### Task 3: Update imports in Convex modules

> **Note:** Only deploy (`npx convex push`) after Task 2 env vars are set.

**Files:**
- Modify: `packages/athena-webapp/convex/inventory/productSku.ts:3` — change import
- Modify: `packages/athena-webapp/convex/inventory/stores.ts:9` — change import
- Modify: `packages/athena-webapp/convex/inventory/products.ts:7` — change import

- [ ] **Step 1: Update `productSku.ts` imports**

Replace:
```typescript
import { deleteFileInS3, uploadFileToS3 } from "../aws/aws";
```
With:
```typescript
import { deleteFileInR2, uploadFileToR2 } from "../cloudflare/r2";
```

And update function calls in `uploadImages` action (line 117):
- `uploadFileToS3(` → `uploadFileToR2(`

And in `deleteImages` action (line 136):
- `deleteFileInS3(url)` → `deleteFileInR2(url)`

And in `nukeProblematicImages` mutation (lines 145-171), replace the full handler:

Before:
```typescript
const bucket = process.env.AWS_BUCKET;

if (!bucket) throw new Error("Missing AWS_BUCKET env var");

const updates = productSkus.flatMap((sku) => {
  if (!Array.isArray(sku.images)) return [];

  const validImages = sku.images.filter(
    (img) => typeof img === "string" && img.includes(bucket)
  );
```

After:
```typescript
const publicUrl = process.env.R2_PUBLIC_URL;

if (!publicUrl) throw new Error("Missing R2_PUBLIC_URL env var");

const updates = productSkus.flatMap((sku) => {
  if (!Array.isArray(sku.images)) return [];

  const validImages = sku.images.filter(
    (img) => typeof img === "string" && img.includes(publicUrl)
  );
```

- [ ] **Step 2: Update `stores.ts` imports**

Replace:
```typescript
import { listItemsInS3Directory, uploadFileToS3 } from "../aws/aws";
```
With:
```typescript
import { listItemsInR2Directory, uploadFileToR2 } from "../cloudflare/r2";
```

And update all function calls:
- `uploadFileToS3(` → `uploadFileToR2(` (line 275)
- `listItemsInS3Directory(` → `listItemsInR2Directory(` (lines 49, 306, 336)

- [ ] **Step 3: Update `products.ts` imports**

Replace:
```typescript
import { deleteDirectoryInS3 } from "../aws/aws";
```
With:
```typescript
import { deleteDirectoryInR2 } from "../cloudflare/r2";
```

And update function call:
- `deleteDirectoryInS3(` → `deleteDirectoryInR2(` (line 750)

- [ ] **Step 4: Verify no remaining imports from `../aws/aws`**

Run: `grep -r "from.*aws/aws" packages/athena-webapp/convex/`

Expected: No results (zero remaining references)

- [ ] **Step 5: Commit**

```bash
git add packages/athena-webapp/convex/inventory/productSku.ts packages/athena-webapp/convex/inventory/stores.ts packages/athena-webapp/convex/inventory/products.ts
git commit -m "refactor: switch all storage imports from S3 to R2"
```

---

### Task 4: Update hardcoded S3 URLs

**Files:**
- Modify: `packages/athena-webapp/convex/storeFront/offers.ts:23-24` — hardcoded hero image URL
- Modify: `packages/athena-webapp/convex/emails/OrderEmail.tsx:58,69,86` — hardcoded S3 URLs in email template
- Modify: `packages/storefront-webapp/src/components/ui/modals/config/welcomeBackModalConfig.tsx:13` — hardcoded background image
- Modify: `packages/storefront-webapp/src/components/ui/modals/config/leaveReviewModalConfig.tsx:13` — hardcoded background image

- [ ] **Step 1: Update `offers.ts` hero image URL**

Replace:
```typescript
const heroImageUrl =
  "https://athena-amzn-bucket.s3.eu-west-1.amazonaws.com/stores/nn7byz68a3j4tfjvgdf9evpt3n78kk38/assets/a0171a4f-036a-4928-3387-8b578e4f297d.webp";
```
With:
```typescript
const heroImageUrl =
  "https://images.wigclub.store/stores/nn7byz68a3j4tfjvgdf9evpt3n78kk38/assets/a0171a4f-036a-4928-3387-8b578e4f297d.webp";
```

- [ ] **Step 2: Update `OrderEmail.tsx` hardcoded S3 URLs**

Replace all occurrences of:
```
https://athena-amzn-bucket.s3.eu-west-1.amazonaws.com/
```
With:
```
https://images.wigclub.store/
```

There are 3 occurrences in this file (lines ~58, ~69, ~86).

- [ ] **Step 3: Update `welcomeBackModalConfig.tsx` default background image**

Replace:
```typescript
export const defaultBackgroundImageUrl =
  "https://athena-amzn-bucket.s3.eu-west-1.amazonaws.com/stores/nn7byz68a3j4tfjvgdf9evpt3n78kk38/products/n5790y3zfjn41k43ghjtqhjbxh7c5n5j/66093c1a-01c0-4f90-5e91-4f91231e906a.webp";
```
With:
```typescript
export const defaultBackgroundImageUrl =
  "https://images.wigclub.store/stores/nn7byz68a3j4tfjvgdf9evpt3n78kk38/products/n5790y3zfjn41k43ghjtqhjbxh7c5n5j/66093c1a-01c0-4f90-5e91-4f91231e906a.webp";
```

- [ ] **Step 4: Update `leaveReviewModalConfig.tsx` default background image**

Same replacement as Step 3 — replace the `athena-amzn-bucket.s3.eu-west-1.amazonaws.com` prefix with `images.wigclub.store`.

- [ ] **Step 5: Verify no remaining hardcoded S3 URLs**

Run: `grep -r "athena-amzn-bucket" packages/athena-webapp/ packages/storefront-webapp/ --include="*.ts" --include="*.tsx"`

Expected: No results

- [ ] **Step 6: Commit**

```bash
git add packages/athena-webapp/convex/storeFront/offers.ts packages/athena-webapp/convex/emails/OrderEmail.tsx packages/storefront-webapp/src/components/ui/modals/config/welcomeBackModalConfig.tsx packages/storefront-webapp/src/components/ui/modals/config/leaveReviewModalConfig.tsx
git commit -m "fix: replace hardcoded S3 URLs with R2 custom domain"
```

---

### Task 5: Delete the old AWS module

**Files:**
- Delete: `packages/athena-webapp/convex/aws/aws.ts`
- Modify: `packages/athena-webapp/package.json` — keep `@aws-sdk/client-s3` (R2 uses it)

- [ ] **Step 1: Delete the old S3 module**

```bash
rm packages/athena-webapp/convex/aws/aws.ts
rmdir packages/athena-webapp/convex/aws/
```

- [ ] **Step 2: Verify no broken imports**

Run: `grep -r "aws/aws" packages/athena-webapp/convex/`

Expected: No results

- [ ] **Step 3: Commit**

```bash
git add -A packages/athena-webapp/convex/aws/
git commit -m "chore: remove old AWS S3 module"
```

---

### Task 6: Bulk copy objects from S3 to R2

**Manual step — run from local machine or droplet.**

- [ ] **Step 1: Install rclone (if not already installed)**

```bash
# macOS
brew install rclone

# Ubuntu (on droplet)
curl https://rclone.org/install.sh | sudo bash
```

- [ ] **Step 2: Configure rclone with both remotes**

```bash
rclone config
```

Create two remotes:

**Remote 1 — `s3-aws`:**
- Type: `s3`
- Provider: `AWS`
- Access Key ID: *(your AWS access key)*
- Secret Access Key: *(your AWS secret key)*
- Region: `eu-west-1`

**Remote 2 — `r2-cf`:**
- Type: `s3`
- Provider: `Cloudflare`
- Access Key ID: *(your R2 access key)*
- Secret Access Key: *(your R2 secret key)*
- Endpoint: `https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com`
- ACL: leave empty

- [ ] **Step 3: Dry-run the copy to verify what will transfer**

```bash
rclone copy s3-aws:athena-amzn-bucket r2-cf:athena-images --dry-run --progress
```

Expected: Shows list of files that would be copied, no errors.

- [ ] **Step 4: Run the actual copy**

```bash
rclone copy s3-aws:athena-amzn-bucket r2-cf:athena-images --progress
```

- [ ] **Step 5: Verify object counts match**

```bash
rclone size s3-aws:athena-amzn-bucket
rclone size r2-cf:athena-images
```

Expected: Same number of objects and total size.

---

### Task 7: Migrate database URLs

**Files:**
- Create: `packages/athena-webapp/convex/cloudflare/migrateUrls.ts` (temporary — delete after use)

- [ ] **Step 1: Create the one-time migration mutation**

```typescript
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

const OLD_PREFIX = "https://athena-amzn-bucket.s3.eu-west-1.amazonaws.com/";
const NEW_PREFIX = "https://images.wigclub.store/";
const BATCH_SIZE = 100; // Stay well within Convex transaction limits

// Migrate productSku image URLs — run repeatedly until isDone: true
export const migrateProductSkuImages = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("productSku")
      .paginate({ numItems: BATCH_SIZE, cursor: args.cursor ?? null });

    let updatedCount = 0;

    for (const sku of results.page) {
      if (!Array.isArray(sku.images)) continue;

      const hasOldUrls = sku.images.some(
        (img: string) => typeof img === "string" && img.startsWith(OLD_PREFIX)
      );

      if (!hasOldUrls) continue;

      const newImages = sku.images.map((img: string) =>
        typeof img === "string" ? img.replace(OLD_PREFIX, NEW_PREFIX) : img
      );

      await ctx.db.patch(sku._id, { images: newImages });
      updatedCount++;
    }

    return {
      success: true,
      updatedCount,
      isDone: results.isDone,
      cursor: results.continueCursor,
    };
  },
});

// Migrate storeAsset URLs — run repeatedly until isDone: true
export const migrateStoreAssetUrls = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("storeAsset")
      .paginate({ numItems: BATCH_SIZE, cursor: args.cursor ?? null });

    let updatedCount = 0;

    for (const asset of results.page) {
      if (typeof asset.url === "string" && asset.url.startsWith(OLD_PREFIX)) {
        await ctx.db.patch(asset._id, {
          url: asset.url.replace(OLD_PREFIX, NEW_PREFIX),
        });
        updatedCount++;
      }
    }

    return {
      success: true,
      updatedCount,
      isDone: results.isDone,
      cursor: results.continueCursor,
    };
  },
});

// Migrate store config image URLs (small table — no pagination needed)
export const migrateStoreConfigUrls = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allStores = await ctx.db.query("store").collect();
    let updatedCount = 0;

    for (const store of allStores) {
      if (!store.config?.ui) continue;

      const ui = store.config.ui as Record<string, any>;
      let needsUpdate = false;
      const newUi = { ...ui };

      for (const key of [
        "fallbackImageUrl",
        "heroImageUrl",
        "shopLookImageUrl",
      ]) {
        if (
          typeof newUi[key] === "string" &&
          newUi[key].startsWith(OLD_PREFIX)
        ) {
          newUi[key] = newUi[key].replace(OLD_PREFIX, NEW_PREFIX);
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        await ctx.db.patch(store._id, {
          config: { ...store.config, ui: newUi },
        });
        updatedCount++;
      }
    }

    return { success: true, updatedCount };
  },
});
```

> **Note on pagination:** `migrateProductSkuImages` and `migrateStoreAssetUrls` are paginated to avoid Convex transaction limits. Run each repeatedly from the dashboard, passing the returned `cursor` as the argument, until `isDone: true`. `migrateStoreConfigUrls` is not paginated since the `store` table is small.

- [ ] **Step 2: Deploy to Convex**

Run: `cd /Users/kwamina/athena/packages/athena-webapp && npx convex push`

- [ ] **Step 3: Run the migrations from the Convex dashboard**

In the Convex dashboard, go to the Functions tab and run:

1. `cloudflare/migrateUrls:migrateProductSkuImages` — run with no args first, then pass the returned `cursor` and re-run until `isDone: true`
2. `cloudflare/migrateUrls:migrateStoreAssetUrls` — same approach: re-run with cursor until `isDone: true`
3. `cloudflare/migrateUrls:migrateStoreConfigUrls` — run once (no pagination needed)

- [ ] **Step 4: Spot-check migrated URLs**

Open a few product pages on `wigclub.store` and verify images load correctly from `images.wigclub.store`. Check:
- Product listing images
- Product detail page images
- Hero header image
- Email preview (if possible)

- [ ] **Step 5: Commit the migration file**

```bash
git add packages/athena-webapp/convex/cloudflare/migrateUrls.ts
git commit -m "feat: add one-time URL migration mutations for S3 to R2"
```

---

### Task 8: Cleanup

- [ ] **Step 1: Delete the migration file**

After verifying everything works:

```bash
rm packages/athena-webapp/convex/cloudflare/migrateUrls.ts
```

- [ ] **Step 2: Remove old AWS env vars from Convex dashboards**

Remove from both production and dev:
- `AWS_REGION`
- `AWS_ACCESS`
- `AWS_SECRET`
- `AWS_BUCKET`

- [ ] **Step 3: Delete the old `convex/aws/` client file on the frontend (if it exists)**

Check: `packages/athena-webapp/src/lib/aws.ts` — this was already commented out, safe to delete.

```bash
rm packages/athena-webapp/src/lib/aws.ts
```

- [ ] **Step 4: Commit cleanup**

```bash
git add -A
git commit -m "chore: remove migration script and legacy AWS references"
```

- [ ] **Step 5: Update infrastructure memory**

Update `project_infra_migration.md` to mark S3 as decommissioned and note R2 is now the image store.

---

### Rollback Plan

If something breaks after deployment:

1. **Revert code:** `git revert` the commits from Tasks 1, 3-5 to restore the S3 module and imports
2. **Keep AWS env vars:** The old `AWS_*` env vars should not be removed until everything is verified (Task 2 Step 3)
3. **S3 data is preserved:** Task 6 uses `rclone copy` (not move), so all original S3 objects remain untouched
4. **Database URLs:** If URLs were already migrated (Task 7), run the migration mutations in reverse (swap `OLD_PREFIX` and `NEW_PREFIX`) to restore S3 URLs
