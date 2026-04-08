/**
 * registry.js — Wallet → Arc Contract address storage
 *
 * Uses Upstash Redis when deployed on Vercel (KV_REST_API_URL is set).
 * Falls back to a local JSON file for local development.
 *
 * Vercel KV was deprecated — Upstash Redis is the recommended replacement.
 * Setup: Vercel Dashboard → Integrations → Upstash Redis → Connect
 *        This sets KV_REST_API_URL and KV_REST_API_TOKEN automatically.
 *
 * Keys are stored as:  "autohedge:treasury:0xlowercase..."
 */

import fs   from 'fs';
import path from 'path';

const KEY_PREFIX        = 'autohedge:treasury:v2:';
const LOCAL_FILE_PATH   = path.join(process.cwd(), '.local-registry.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(walletAddress) {
  return walletAddress.toLowerCase().trim();
}

// ── Local JSON fallback (dev only) ────────────────────────────────────────────

function readLocal() {
  try {
    if (fs.existsSync(LOCAL_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(LOCAL_FILE_PATH, 'utf8'));
    }
  } catch { /* ignore */ }
  return {};
}

function writeLocal(data) {
  try {
    fs.writeFileSync(LOCAL_FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[registry] Could not write local file:', e.message);
  }
}

// ── Upstash Redis (production) ───────────────────────────────────────────────

async function getRedis() {
  // Lazy import so local builds without @upstash/redis still work
  const { Redis } = await import('@upstash/redis');
  return new Redis({
    url:   process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the Arc contract address for a given wallet, or null if none exists.
 * @param {string} walletAddress
 * @returns {Promise<string|null>}
 */
export async function getTreasury(walletAddress) {
  const key = KEY_PREFIX + normalize(walletAddress);

  if (process.env.KV_REST_API_URL) {
    try {
      const redis = await getRedis();
      return await redis.get(key);
    } catch (e) {
      console.error('[registry] Redis get failed:', e.message);
      return null;
    }
  }

  // Local fallback
  const local = readLocal();
  return local[key] ?? null;
}

/**
 * Saves the Arc contract address for a given wallet.
 * @param {string} walletAddress
 * @param {string} contractAddress
 */
export async function setTreasury(walletAddress, contractAddress) {
  const key = KEY_PREFIX + normalize(walletAddress);

  if (process.env.KV_REST_API_URL) {
    try {
      const redis = await getRedis();
      await redis.set(key, contractAddress);
      return;
    } catch (e) {
      console.error('[registry] Redis set failed:', e.message);
      // Fall through to local backup
    }
  }

  // Local fallback
  const local = readLocal();
  local[key]  = contractAddress;
  writeLocal(local);
}
