import { Injectable, Logger } from '@nestjs/common';
import { Storage } from '@google-cloud/storage';

export interface UploadFileOptions {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  townSlug: string;
  entityType: string;
  entityId: string;
  folder?: string;
  /**
   * Sensitive files (identity/legal documents) must not be cached by shared caches and are
   * served through short-lived signed URLs (see getSignedReadUrl), never the raw public URL.
   */
  isPrivate?: boolean;
}

export interface UploadedFile {
  fileName: string;
  publicUrl: string;
  gcpPath: string;
  size: number;
}

@Injectable()
export class GcpStorageService {
  private readonly logger = new Logger(GcpStorageService.name);
  private storage: Storage;
  private bucketName: string;

  constructor() {
    this.initializeStorage();
    this.bucketName = process.env.GCP_BUCKET_NAME || 'binntu-documents';
  }

  private initializeStorage() {
    const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

    if (credentialsJson) {
      try {
        const credentials = JSON.parse(credentialsJson);
        this.storage = new Storage({
          projectId: credentials.project_id,
          credentials: credentials,
        });
        this.logger.log('GCP Storage initialized with credentials from environment');
      } catch (error) {
        this.logger.error('Error parsing GOOGLE_APPLICATION_CREDENTIALS_JSON:', error);
        throw new Error('Invalid GCP credentials JSON');
      }
    } else {
      this.storage = new Storage();
      this.logger.warn('GCP Storage initialized with default credentials (ADC)');
    }
  }

  async uploadFile(options: UploadFileOptions): Promise<UploadedFile> {
    const { buffer, originalName, mimeType, townSlug, entityType, entityId, folder, isPrivate } = options;

    const bucket = this.storage.bucket(this.bucketName);

    // Generate unique filename
    const timestamp = Date.now();
    const safeFileName = originalName
      .replace(/\s+/g, '-')
      .replace(/[<>:"/\\|?*()]/g, '_')
      .replace(/-+/g, '-')
      .replace(/_+/g, '_');

    const fileName = `${timestamp}-${safeFileName}`;

    // Create folder structure: town/entityType/entityId/folder/file
    const folderPath = folder ? `${folder}/` : '';
    const gcpPath = `documents/${townSlug}/${entityType}/${entityId}/${folderPath}${fileName}`;

    const file = bucket.file(gcpPath);

    this.logger.log(`Uploading to GCP Storage: ${gcpPath}`);

    await file.save(buffer, {
      metadata: {
        contentType: mimeType,
        cacheControl: isPrivate ? 'private, max-age=0, no-store' : 'public, max-age=31536000',
      },
    });

    const baseUrl = process.env.GOOGLE_CLOUD_STORAGE_BASE_URL || 'https://storage.googleapis.com';
    const encodedPath = gcpPath
      .split('/')
      .map(component => encodeURIComponent(component))
      .join('/');
    const publicUrl = `${baseUrl}/${this.bucketName}/${encodedPath}`;

    this.logger.log(`File uploaded successfully: ${gcpPath}`);

    return {
      fileName,
      publicUrl,
      gcpPath,
      size: buffer.length,
    };
  }

  /**
   * Short-lived V4 signed read URL. Requires service-account credentials with a private key
   * (GOOGLE_APPLICATION_CREDENTIALS_JSON); returns null when signing is not possible so callers
   * can fall back.
   */
  async getSignedReadUrl(gcpPath: string, expiresInMinutes = 15): Promise<string | null> {
    try {
      const [url] = await this.storage
        .bucket(this.bucketName)
        .file(gcpPath)
        .getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + expiresInMinutes * 60 * 1000 });
      return url;
    } catch (error) {
      this.logger.warn(`Could not sign URL for ${gcpPath}: ${(error as Error).message}`);
      return null;
    }
  }

  async deleteFile(gcpPath: string): Promise<void> {
    try {
      const bucket = this.storage.bucket(this.bucketName);
      const file = bucket.file(gcpPath);
      await file.delete();
      this.logger.log(`Deleted file from GCP Storage: ${gcpPath}`);
    } catch (error) {
      this.logger.error('Error deleting file from GCP Storage:', error);
      throw error;
    }
  }

  async listFiles(prefix: string): Promise<string[]> {
    try {
      const bucket = this.storage.bucket(this.bucketName);
      const [files] = await bucket.getFiles({ prefix });
      return files.map(file => file.name);
    } catch (error) {
      this.logger.error('Error listing files from GCP Storage:', error);
      throw error;
    }
  }
}
