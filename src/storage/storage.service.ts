import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const allowedMimeTypes = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

type AllowedMimeType = keyof typeof allowedMimeTypes;

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly maxUploadSize: number;
  private readonly publicBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.getOrThrow<string>('storage.bucket');
    this.publicBaseUrl =
      this.configService.getOrThrow<string>('storage.publicBaseUrl');
    this.maxUploadSize =
      this.configService.getOrThrow<number>('storage.maxUploadSize');
    this.client = new S3Client({
      region: 'us-east-1',
      endpoint: this.configService.getOrThrow<string>('storage.endpoint'),
      credentials: {
        accessKeyId:
          this.configService.getOrThrow<string>('storage.accessKey'),
        secretAccessKey:
          this.configService.getOrThrow<string>('storage.secretKey'),
      },
      forcePathStyle:
        this.configService.getOrThrow<boolean>('storage.forcePathStyle'),
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async createCatalogItemImageUploadUrl(input: {
    userId: string;
    itemId: string;
    fileName: string;
    mimeType: string;
    size: number;
  }) {
    this.validateUploadInput(input.mimeType, input.size);

    const storageKey = this.generateCatalogItemImageStorageKey(
      input.userId,
      input.itemId,
      input.fileName,
      input.mimeType as AllowedMimeType,
    );
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      ContentType: input.mimeType,
    });
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: 300,
    });

    return {
      uploadUrl,
      storageKey,
      constraints: {
        allowedMimeTypes: Object.keys(allowedMimeTypes),
        maxUploadSizeBytes: this.maxUploadSize,
        maxImagesPerItem: 5,
        compressionMode: 'lossless-preferred',
      },
    };
  }

  createCatalogItemImagePublicUrl(storageKey: string) {
    const normalizedBaseUrl = this.publicBaseUrl.replace(/\/+$/, '');
    return `${normalizedBaseUrl}/${this.bucket}/${storageKey}`;
  }

  assertCatalogItemImageOwnership(
    userId: string,
    itemId: string,
    storageKey: string,
  ) {
    const expectedPrefix = `catalog-items/${userId}/${itemId}/`;

    if (!storageKey.startsWith(expectedPrefix)) {
      throw new BadRequestException('Invalid catalog item image storageKey');
    }
  }

  async ensureObjectExists(storageKey: string) {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
        }),
      );
    } catch (error) {
      if (error instanceof S3ServiceException) {
        throw new NotFoundException('Uploaded image was not found in storage');
      }

      throw error;
    }
  }

  private validateUploadInput(mimeType: string, size: number) {
    if (!(mimeType in allowedMimeTypes)) {
      throw new BadRequestException(
        'Unsupported mimeType. Allowed values: image/jpeg, image/png, image/webp',
      );
    }

    if (size <= 0 || size > this.maxUploadSize) {
      throw new BadRequestException(
        `File size must be greater than 0 and at most ${this.maxUploadSize} bytes`,
      );
    }
  }

  private generateCatalogItemImageStorageKey(
    userId: string,
    itemId: string,
    fileName: string,
    mimeType: AllowedMimeType,
  ) {
    const extension = this.extractExtension(fileName) ?? allowedMimeTypes[mimeType];
    return `catalog-items/${userId}/${itemId}/${randomUUID()}.${extension}`;
  }

  private extractExtension(fileName: string): string | null {
    const sanitizedFileName = fileName.trim().toLowerCase();
    const lastDotIndex = sanitizedFileName.lastIndexOf('.');

    if (lastDotIndex === -1 || lastDotIndex === sanitizedFileName.length - 1) {
      return null;
    }

    return sanitizedFileName.slice(lastDotIndex + 1);
  }
}
