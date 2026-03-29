import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

const BUCKET = process.env.R2_BUCKET!;
const PUBLIC_URL = process.env.R2_PUBLIC_URL!; // https://images.wigclub.store

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

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
    console.log(
      `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    );
    console.error(error);
  }
};

export const deleteFileInR2 = async (path: string) => {
  const OLD_S3_PREFIX =
    "https://athena-amzn-bucket.s3.eu-west-1.amazonaws.com/";
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
