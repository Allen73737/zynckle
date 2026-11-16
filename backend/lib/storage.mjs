import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { config } from './config.mjs';

/**
 * Object storage behind one interface. Binary content never goes into the JSON store:
 * it lives on local disk (default) or in Cloudflare R2 / any S3-compatible bucket.
 * Each stored record remembers which driver wrote it, so changing configuration
 * later does not orphan existing files.
 */
const uploadsDir = join(config.dataDir, 'uploads');
await mkdir(uploadsDir, { recursive: true });

const safeKey = key => {
  if (typeof key !== 'string' || !/^[A-Za-z0-9/_-]{1,200}$/.test(key) || key.includes('..')) throw new Error('Invalid storage key');
  return key;
};

const local = {
  async put(key, bytes) { const path = join(uploadsDir, safeKey(key)); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); },
  get: key => readFile(join(uploadsDir, safeKey(key))),
  remove: key => rm(join(uploadsDir, safeKey(key)), { force: true }),
};

const hex = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();

async function s3Request(method, key, body) {
  const { endpoint, bucket, accessKeyId, secretAccessKey, region } = config.storage;
  const url = new URL(`${endpoint}/${bucket}/${safeKey(key)}`);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = hex(body || '');
  const signed = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(signed).sort();
  const canonical = [method, url.pathname, '', names.map(n => `${n}:${signed[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, hex(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  const response = await fetch(url, {
    method, body: body || undefined,
    headers: { 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` },
  });
  if (!response.ok && !(method === 'DELETE' && response.status === 404)) throw new Error(`Object storage ${method} failed with ${response.status}`);
  return response;
}

const s3 = {
  put: (key, bytes) => s3Request('PUT', key, bytes),
  get: async key => Buffer.from(await (await s3Request('GET', key)).arrayBuffer()),
  remove: key => s3Request('DELETE', key),
};

const drivers = { local, s3 };
export const storageDriver = config.storage.driver;
export const putObject = async (key, bytes) => { await drivers[storageDriver].put(key, bytes); return storageDriver; };
export const getObject = (key, driver = 'local') => (drivers[driver] || local).get(key);
export const removeObject = (key, driver = 'local') => (drivers[driver] || local).remove(key).catch(error => console.error('Storage delete failed', key, error.message));
