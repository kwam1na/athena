import {
  ListObjectsV2Command,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

type EnvSource = Record<string, string | undefined>;

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
  endpoint: string;
};

const REQUIRED_ENV_KEYS = [
  "CLOUDFLARE_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_URL",
] as const;

let cachedR2:
  | {
      config: R2Config;
      client: S3Client;
    }
  | undefined;

const readEnvValue = (
  env: EnvSource,
  key: (typeof REQUIRED_ENV_KEYS)[number],
): string | undefined => {
  const value = env[key];
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const resolveR2ConfigFromEnv = (
  env: EnvSource = process.env,
): R2Config => {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !readEnvValue(env, key));

  if (missing.length > 0) {
    throw new Error(
      `Missing Cloudflare R2 environment variables: ${missing.join(", ")}`,
    );
  }

  const accountId = readEnvValue(env, "CLOUDFLARE_ACCOUNT_ID")!;

  return {
    accountId,
    accessKeyId: readEnvValue(env, "R2_ACCESS_KEY_ID")!,
    secretAccessKey: readEnvValue(env, "R2_SECRET_ACCESS_KEY")!,
    bucket: readEnvValue(env, "R2_BUCKET")!,
    publicUrl: readEnvValue(env, "R2_PUBLIC_URL")!,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  };
};

const getR2 = () => {
  const config = resolveR2ConfigFromEnv();

  if (
    cachedR2 &&
    cachedR2.config.accountId === config.accountId &&
    cachedR2.config.accessKeyId === config.accessKeyId &&
    cachedR2.config.secretAccessKey === config.secretAccessKey &&
    cachedR2.config.bucket === config.bucket &&
    cachedR2.config.publicUrl === config.publicUrl
  ) {
    return cachedR2;
  }

  cachedR2 = {
    config,
    client: new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    }),
  };

  return cachedR2;
};

export const uploadFileToR2 = async (file: any, key: string) => {
  const { client, config } = getR2();

  try {
    const params = {
      Bucket: config.bucket,
      Key: key,
      Body: file,
    };

    await client.send(new PutObjectCommand(params));
    return `${config.publicUrl}/${key}`;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const deleteFileInR2 = async (path: string) => {
  const { client, config } = getR2();
  const OLD_S3_PREFIX =
    "https://athena-amzn-bucket.s3.eu-west-1.amazonaws.com/";
  let key = path.split(`${config.publicUrl}/`)[1];
  // Fallback: handle legacy S3 URLs during transition period
  if (!key) key = path.split(OLD_S3_PREFIX)[1];

  if (!key) return;

  try {
    const params = {
      Bucket: config.bucket,
      Key: key,
    };

    await client.send(new DeleteObjectCommand(params));
    return { success: true, key };
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const deleteDirectoryInR2 = async (directory: string) => {
  const { client, config } = getR2();

  try {
    let continuationToken: string | undefined;

    do {
      const listParams = {
        Bucket: config.bucket,
        Prefix: `${directory}/`,
        ContinuationToken: continuationToken,
      };

      const listResponse = await client.send(
        new ListObjectsV2Command(listParams),
      );

      if (listResponse.Contents && listResponse.Contents.length > 0) {
        const deleteParams = {
          Bucket: config.bucket,
          Delete: {
            Objects: listResponse.Contents.map(({ Key }) => ({ Key })),
          },
        };

        await client.send(new DeleteObjectsCommand(deleteParams));
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    const dirParams = {
      Bucket: config.bucket,
      Key: `${directory}/`,
    };
    await client.send(new DeleteObjectCommand(dirParams));

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
  const { client, config } = getR2();

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
        Bucket: config.bucket,
        Prefix: `${directory}/`,
        Delimiter: firstLevelOnly ? "/" : undefined,
        ContinuationToken: continuationToken,
      };

      const listResponse = await client.send(
        new ListObjectsV2Command(listParams),
      );

      if (listResponse.Contents && listResponse.Contents.length > 0) {
        for (const item of listResponse.Contents) {
          if (item.Key) {
            if (firstLevelOnly && item.Key === `${directory}/`) continue;

            items.push({
              key: item.Key,
              url: `${config.publicUrl}/${item.Key}`,
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
              url: `${config.publicUrl}/${prefix.Prefix}`,
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
