import { randomUUID } from 'node:crypto'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import {
  deleteStoredFile,
  extensionForMime,
  MAX_UPLOAD_BYTES,
  readStoredFileBytes,
  saveDocumentBytes,
} from './storage'

export type StorageProviderId = 'local' | 'r2'

export interface DocumentStorageProvider {
  readonly id: StorageProviderId
  saveObject(workspaceId: string, mimeType: string, bytes: Buffer): Promise<string>
  readObject(workspaceId: string, storedName: string): Promise<Buffer | null>
  deleteObject(workspaceId: string, storedName: string): Promise<void>
}

type R2ClientConfig = NonNullable<ConstructorParameters<typeof S3Client>[0]>
type R2ClientFactory = (configuration: R2ClientConfig) => S3Client

const workspaceTokenPattern = /^[a-f0-9]{64}$/
const storedNamePattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(jpg|png|pdf)$/

function validateWorkspaceId(workspaceId: string): void {
  if (!workspaceTokenPattern.test(workspaceId)) {
    throw new Error('Invalid document workspace identifier.')
  }
}

function validateStoredName(storedName: string): void {
  if (!storedNamePattern.test(storedName)) {
    throw new Error('Invalid document object key.')
  }
}

function makeStoredName(mimeType: string): string {
  const extension = extensionForMime(mimeType)
  if (!extension) throw new Error('Unsupported document content type.')
  return `${randomUUID()}${extension}`
}

/** Local filesystem provider — retains the existing private-disk workflow. */
class LocalStorageProvider implements DocumentStorageProvider {
  readonly id = 'local' as const

  saveObject(workspaceId: string, mimeType: string, bytes: Buffer): Promise<string> {
    return saveDocumentBytes(workspaceId, mimeType, bytes)
  }

  readObject(workspaceId: string, storedName: string): Promise<Buffer | null> {
    return readStoredFileBytes(workspaceId, storedName)
  }

  deleteObject(workspaceId: string, storedName: string): Promise<void> {
    return deleteStoredFile(workspaceId, storedName)
  }
}

class R2StorageProvider implements DocumentStorageProvider {
  readonly id = 'r2' as const
  private readonly bucket: string
  private readonly client: S3Client

  constructor(bucket: string, client: S3Client) {
    this.bucket = bucket
    this.client = client
  }

  private objectKey(workspaceId: string, storedName: string): string {
    validateWorkspaceId(workspaceId)
    validateStoredName(storedName)
    return `workspaces/${workspaceId}/${storedName}`
  }

  async saveObject(workspaceId: string, mimeType: string, bytes: Buffer): Promise<string> {
    const storedName = makeStoredName(mimeType)
    const key = this.objectKey(workspaceId, storedName)
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: bytes,
      ContentLength: bytes.length,
      ContentType: mimeType,
      CacheControl: 'private, no-store',
    }))
    return storedName
  }

  async readObject(workspaceId: string, storedName: string): Promise<Buffer | null> {
    const key = this.objectKey(workspaceId, storedName)
    let output
    try {
      output = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    } catch (error) {
      if (isMissingObject(error)) return null
      throw error
    }

    if (!output.Body || (typeof output.ContentLength === 'number' && output.ContentLength > MAX_UPLOAD_BYTES)) {
      return null
    }
    try {
      const bytes = await output.Body.transformToByteArray()
      return Buffer.from(bytes)
    } catch (error) {
      if (isMissingObject(error)) return null
      throw error
    }
  }

  async deleteObject(workspaceId: string, storedName: string): Promise<void> {
    const key = this.objectKey(workspaceId, storedName)
    // S3 DeleteObject is idempotent; retries safely remove the same private key.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }
}

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } }
  return candidate.name === 'NoSuchKey' || candidate.name === 'NotFound' || candidate.$metadata?.httpStatusCode === 404
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`Missing required R2 environment variable: ${name}`)
  return value
}

/** Factory is exported for deterministic SDK-mocked tests; credentials never leave this server module. */
export function createR2StorageProvider(
  env: NodeJS.ProcessEnv = process.env,
  clientFactory: R2ClientFactory = configuration => new S3Client(configuration)
): DocumentStorageProvider {
  const accountId = requireEnv(env, 'R2_ACCOUNT_ID')
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error('R2_ACCOUNT_ID must be a 32-character Cloudflare account ID.')
  }

  const accessKeyId = requireEnv(env, 'R2_ACCESS_KEY_ID')
  const secretAccessKey = requireEnv(env, 'R2_SECRET_ACCESS_KEY')
  const bucket = requireEnv(env, 'R2_BUCKET_NAME')
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error('R2_BUCKET_NAME must be a valid lowercase R2 bucket name.')
  }

  const client = clientFactory({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  })
  return new R2StorageProvider(bucket, client)
}

export function getStorageProviderId(): StorageProviderId {
  const configured = process.env.DOCUMENT_STORAGE_PROVIDER?.trim().toLowerCase()
  if (configured === 'r2') return 'r2'
  if (configured === 'local') return 'local'
  if (!configured && process.env.NODE_ENV !== 'production') return 'local'
  if (!configured) throw new Error('DOCUMENT_STORAGE_PROVIDER must be explicitly set in production.')
  throw new Error('DOCUMENT_STORAGE_PROVIDER must be either local or r2.')
}

let cachedProvider: DocumentStorageProvider | undefined

export function getStorageProvider(): DocumentStorageProvider {
  const id = getStorageProviderId()
  if (!cachedProvider || cachedProvider.id !== id) {
    cachedProvider = id === 'r2' ? createR2StorageProvider() : new LocalStorageProvider()
  }
  return cachedProvider
}
