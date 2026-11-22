import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const backendDir = resolve(import.meta.dirname, '..');

// Load KEY=value pairs from the repository .env without overriding the real environment.
const envFile = resolve(process.env.ZYNCKLE_ENV_FILE || join(backendDir, '..', '.env'));
try {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
} catch { /* .env is optional */ }

const env = process.env;
const mb = value => Math.max(1, Number(value) || 0) * 1024 * 1024;
const dataFile = resolve(env.ZYNCKLE_DATA_FILE || join(backendDir, 'data', 'workspace.json'));
const dataDir = dirname(dataFile);
mkdirSync(dataDir, { recursive: true });

// A stable signing secret is needed for signed file URLs; generate one locally if none is configured.
function loadSecret() {
  if (env.ZYNCKLE_SECRET && env.ZYNCKLE_SECRET.length >= 32) return env.ZYNCKLE_SECRET;
  const secretFile = join(dataDir, '.secret');
  if (existsSync(secretFile)) return readFileSync(secretFile, 'utf8').trim();
  const secret = randomBytes(48).toString('hex');
  writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

const origins = (env.ZYNCKLE_FRONTEND_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim()).filter(Boolean);

export const config = {
  production: env.NODE_ENV === 'production',
  host: env.HOST || '127.0.0.1',
  port: Number(env.PORT || 8080),
  origins,
  publicUrl: (env.ZYNCKLE_PUBLIC_URL || origins[0]).replace(/\/$/, ''),
  dataFile,
  dataDir,
  secret: loadSecret(),
  exposeDevLinks: env.NODE_ENV !== 'production' && env.ZYNCKLE_EXPOSE_DEV_LINKS !== 'false',
  maxUploadBytes: mb(env.MAX_UPLOAD_MB || 25),
  maxZipBytes: mb(env.MAX_ZIP_MB || 40),
  quotaBytes: mb(env.WORKSPACE_QUOTA_MB || 1024),
  latexBin: env.LATEX_COMPILER || 'built-in',
  ai: {
    provider: (env.AI_PROVIDER || '').toLowerCase(),
    requestsPerMinute: Number(env.AI_REQUESTS_PER_MINUTE || 20),
    requestsPerDay: Number(env.AI_REQUESTS_PER_DAY || 400),
    groq: { key: env.GROQ_API_KEY || '', model: env.GROQ_MODEL || 'llama-3.3-70b-versatile' },
    gemini: { key: env.GEMINI_API_KEY || '', model: env.GEMINI_MODEL || 'gemini-2.5-flash' },
    openrouter: { key: env.OPENROUTER_API_KEY || '', model: env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct' },
    // Any OpenAI-compatible server: Ollama, LM Studio, vLLM, OpenAI itself. The key is optional.
    custom: { url: (env.CUSTOM_AI_URL || '').replace(/\/$/, ''), key: env.CUSTOM_AI_API_KEY || '', model: env.CUSTOM_AI_MODEL || '', label: env.CUSTOM_AI_LABEL || 'OpenAI-compatible' },
  },
  google: { clientId: env.GOOGLE_CLIENT_ID || '', clientSecret: env.GOOGLE_CLIENT_SECRET || '' },
  storage: {
    driver: env.R2_ENDPOINT && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY ? 's3' : 'local',
    endpoint: (env.R2_ENDPOINT || '').replace(/\/$/, ''),
    bucket: env.R2_BUCKET || '',
    accessKeyId: env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: env.R2_SECRET_ACCESS_KEY || '',
    region: env.R2_REGION || 'auto',
  },
};
