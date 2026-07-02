import { createHash, randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { RedisService } from '../redis/redis.service';

const allowedMimeTypes = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export const CATALOG_ITEM_IMAGE_UPLOAD_URL_TTL_SECONDS = 5 * 60;
export const CATALOG_ITEM_IMAGE_READ_URL_TTL_SECONDS = 60 * 60;
export const CATALOG_ITEM_IMAGE_READ_URL_CACHE_TTL_SECONDS = 5 * 60;
const CATALOG_ITEM_IMAGE_READ_URL_CACHE_MAX_ENTRIES = 2000;
const CATALOG_ITEM_IMAGE_READ_URL_CACHE_KEY_PREFIX =
  'catalog:storage:media-read-url';
const CATALOG_ITEM_THUMBNAIL_PRESET = {
  width: 640,
  height: 640,
  quality: 75,
};

type AllowedMimeType = keyof typeof allowedMimeTypes;
type CachedSignedUrl = {
  url: string;
  expiresAt: number;
  source?: 'redis' | 'local';
};

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly maxUploadSize: number;
  private readonly publicBaseUrl: string;
  private readonly mediaCdnBaseUrl?: string;
  private readonly readUrlCache = new Map<string, CachedSignedUrl>();

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    this.bucket = this.configService.getOrThrow<string>('storage.bucket');
    this.publicBaseUrl =
      this.configService.getOrThrow<string>('storage.publicBaseUrl');
    this.mediaCdnBaseUrl =
      this.configService.get<string>('storage.mediaCdnBaseUrl')?.trim() ||
      undefined;
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
      expiresIn: CATALOG_ITEM_IMAGE_UPLOAD_URL_TTL_SECONDS,
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

  createCatalogItemImageThumbnailUrl(storageKey: string) {
    return this.createCdnImageUrl(storageKey, CATALOG_ITEM_THUMBNAIL_PRESET);
  }

  async createCatalogItemImageReadUrl(storageKey: string) {
    const startedAt = Date.now();
    const cached = await this.getCachedReadUrl(storageKey);

    if (cached) {
      this.logger.debug({
        event: 'storage.signed_url_cache',
        service: 'catalog',
        mediaType: 'catalog_item_image',
        result: `${cached.source ?? 'local'}_hit`,
        durationMs: Date.now() - startedAt,
      });
      return cached.url;
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });

    const url = await getSignedUrl(this.client, command, {
      expiresIn: CATALOG_ITEM_IMAGE_READ_URL_TTL_SECONDS,
    });

    this.cacheReadUrl(
      storageKey,
      url,
      CATALOG_ITEM_IMAGE_READ_URL_CACHE_TTL_SECONDS,
    );

    this.logger.log({
      event: 'storage.signed_url_generated',
      service: 'catalog',
      mediaType: 'catalog_item_image',
      durationMs: Date.now() - startedAt,
      signedUrlTtlSeconds: CATALOG_ITEM_IMAGE_READ_URL_TTL_SECONDS,
      cacheTtlSeconds: CATALOG_ITEM_IMAGE_READ_URL_CACHE_TTL_SECONDS,
    });

    return url;
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

  private async getCachedReadUrl(storageKey: string) {
    try {
      const cachedUrl = await this.redisService
        .getClient()
        .get(this.buildReadUrlCacheKey(storageKey));

      if (cachedUrl) {
        return {
          url: cachedUrl,
          expiresAt:
            Date.now() + CATALOG_ITEM_IMAGE_READ_URL_CACHE_TTL_SECONDS * 1000,
          source: 'redis',
        };
      }
    } catch (error) {
      this.logger.warn(
        { err: error },
        'Redis media read URL cache read failed',
      );
    }

    const cached = this.readUrlCache.get(storageKey);

    if (cached && cached.expiresAt > Date.now()) {
      return {
        ...cached,
        source: 'local',
      };
    }

    return null;
  }

  private cacheReadUrl(storageKey: string, url: string, ttlSeconds: number) {
    if (this.readUrlCache.size >= CATALOG_ITEM_IMAGE_READ_URL_CACHE_MAX_ENTRIES) {
      const oldestKey = this.readUrlCache.keys().next().value;

      if (oldestKey) {
        this.readUrlCache.delete(oldestKey);
      }
    }

    this.readUrlCache.set(storageKey, {
      url,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });

    void this.redisService
      .getClient()
      .set(this.buildReadUrlCacheKey(storageKey), url, 'EX', ttlSeconds)
      .catch((error: unknown) => {
        this.logger.warn(
          { err: error },
          'Redis media read URL cache write failed',
        );
      });
  }

  private buildReadUrlCacheKey(storageKey: string) {
    return `${CATALOG_ITEM_IMAGE_READ_URL_CACHE_KEY_PREFIX}:${createHash('sha256')
      .update(storageKey)
      .digest('hex')}`;
  }

  private createCdnImageUrl(
    storageKey: string,
    options: { width: number; height: number; quality: number },
  ) {
    if (!this.mediaCdnBaseUrl) {
      return null;
    }

    const normalizedBaseUrl = this.mediaCdnBaseUrl.replace(/\/+$/, '');
    const encodedStoragePath = storageKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const transform = [
      `width=${options.width}`,
      `height=${options.height}`,
      'fit=cover',
      `quality=${options.quality}`,
      'format=webp',
    ].join(',');

    return `${normalizedBaseUrl}/cdn-cgi/image/${transform}/${this.bucket}/${encodedStoragePath}`;
  }
}
