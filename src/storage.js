// Хранилище файлов: Neon Object Storage (S3-совместимое) или память процесса для тестов.
// Интерфейс: put(key, bytes, contentType), get(key) → { bytes, contentType } | null, remove(key).
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const IMMUTABLE = 'public, max-age=31536000, immutable'; // каждый новый файл получает новый ключ

/**
 * Бакет Neon. Ключи доступа, адрес и регион берутся из AWS_* переменных (их пишет `neon env pull`).
 * @param {{ bucket: string }} options
 */
export function createS3Storage({ bucket }) {
  const s3 = new S3Client({ forcePathStyle: true }); // Neon требует path-style адреса
  return {
    kind: 'neon',
    async put(key, bytes, contentType) {
      await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: bytes, ContentType: contentType, CacheControl: IMMUTABLE,
      }));
    },
    async get(key) {
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return { bytes: Buffer.from(await res.Body.transformToByteArray()), contentType: res.ContentType };
      } catch (err) {
        if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },
    async remove(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

/** Файлы в памяти — для тестов и запуска без бакета. */
export function createMemoryStorage() {
  const files = new Map();
  return {
    kind: 'memory',
    files,
    async put(key, bytes, contentType) { files.set(key, { bytes: Buffer.from(bytes), contentType }); },
    async get(key) { return files.get(key) ?? null; },
    async remove(key) { files.delete(key); },
  };
}

/** Бакет, если в окружении есть его адрес и ключи; иначе null (загрузка фото будет выключена). */
export function storageFromConfig(cfg) {
  return cfg.storage.enabled ? createS3Storage({ bucket: cfg.storage.bucket }) : null;
}
