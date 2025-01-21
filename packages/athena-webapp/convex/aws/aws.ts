import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS!,
    secretAccessKey: process.env.AWS_SECRET!,
  },
});

export const uploadFileToS3 = async (file: any, key: string) => {
  try {
    const params = {
      Bucket: process.env.AWS_BUCKET,
      Key: key,
      Body: file,
    };

    await s3.send(new PutObjectCommand(params));
    return `https://${process.env.AWS_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
  } catch (error) {
    console.error("Error uploading file", error);
  }
};

export const deleteFileInS3 = async (path: string) => {
  const key = path.split(
    `https://${process.env.AWS_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/`
  )[1];

  try {
    const params = {
      Bucket: process.env.AWS_BUCKET,
      Key: key,
    };

    await s3.send(new DeleteObjectCommand(params));
    return { success: true, key };
  } catch (error) {
    console.error("Error deleting file", error);
  }
};

export const deleteDirectoryInS3 = async (directory: string) => {
  try {
    let continuationToken: string | undefined;

    do {
      // List objects in the "directory"
      const listParams = {
        Bucket: `${process.env.AWS_BUCKET}`,
        Prefix: `${directory}/`,
        ContinuationToken: continuationToken,
      };

      const listResponse = await s3.send(new ListObjectsV2Command(listParams));

      if (listResponse.Contents && listResponse.Contents.length > 0) {
        // Delete objects in batches of 1000 (S3 limit)
        const deleteParams = {
          Bucket: `${process.env.AWS_BUCKET}`,
          Delete: {
            Objects: listResponse.Contents.map(({ Key }) => ({ Key })),
          },
        };

        await s3.send(new DeleteObjectsCommand(deleteParams));
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    // Optionally, delete the "directory" object itself if it exists
    const dirParams = {
      Bucket: `${process.env.AWS_BUCKET}`,
      Key: `${directory}/`,
    };
    await s3.send(new DeleteObjectCommand(dirParams));

    return { success: true, directory };
  } catch (error) {
    console.error("Error deleting directory", error);
    return { success: false, error, directory };
  }
};
