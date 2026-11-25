import { CapturedPacket, FirewallRule, FriendlyAppId, KeylogEntry } from '../types/capture';
import { bytesToHex, dissectRawIpPacket, hexToBytes } from './dissector';

const DB_NAME = 'sadnan_capture_vault_db';
const DB_VERSION = 1;
const STORE_CHUNKS = 'encrypted_chunks';
const STORE_META = 'session_meta';

export interface EncryptedChunkRecord {
  id: string;
  sessionId: string;
  chunkIndex: number;
  ivBase64: string;
  ciphertextBase64: string;
  packetCount: number;
  createdAtMs: number;
}

export interface VaultSessionMeta {
  sessionId: string;
  saltBase64: string;
  status: 'ACTIVE' | 'CLOSED_CLEAN';
  startedAtMs: number;
  updatedAtMs: number;
  totalPackets: number;
  appId: FriendlyAppId;
}

export interface EncVaultFile {
  format: 'sadnan-capture-aes256gcm-v1';
  exportedAt: string;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  saltBase64: string;
  chunks: EncryptedChunkRecord[];
}

function u8ToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const store = db.createObjectStore(STORE_CHUNKS, { keyPath: 'id' });
        store.createIndex('sessionId', 'sessionId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'sessionId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deriveAesGcmKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 120000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

interface SerializedPacketChunkItem {
  sequence: number;
  timestampNs: string;
  timestampMs: number;
  appId: FriendlyAppId;
  appName: string;
  direction: 'OUTBOUND' | 'INBOUND';
  sourceOrigin: 'LOCAL_SANDBOX' | 'SERVER_PROBE' | 'PCAP_IMPORT';
  rawHex: string;
}

export async function encryptPacketChunk(
  packets: CapturedPacket[],
  key: CryptoKey,
  sessionId: string,
  chunkIndex: number
): Promise<EncryptedChunkRecord> {
  const payloadItems: SerializedPacketChunkItem[] = packets.map((p) => ({
    sequence: p.sequence,
    timestampNs: p.timestampNs,
    timestampMs: p.timestampMs,
    appId: p.appId,
    appName: p.appName,
    direction: p.direction,
    sourceOrigin: p.sourceOrigin,
    rawHex: bytesToHex(p.rawBytes),
  }));
  const plaintext = new TextEncoder().encode(JSON.stringify(payloadItems));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext
  );
  return {
    id: `${sessionId}-chunk-${chunkIndex}`,
    sessionId,
    chunkIndex,
    ivBase64: u8ToB64(iv),
    ciphertextBase64: u8ToB64(new Uint8Array(cipherBuf)),
    packetCount: packets.length,
    createdAtMs: Date.now(),
  };
}

export async function decryptPacketChunk(
  chunk: EncryptedChunkRecord,
  key: CryptoKey,
  keylogEntries: KeylogEntry[],
  firewallRules: FirewallRule[]
): Promise<CapturedPacket[]> {
  const iv = b64ToU8(chunk.ivBase64);
  const cipher = b64ToU8(chunk.ciphertextBase64);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    cipher as BufferSource
  );
  const items = JSON.parse(new TextDecoder().decode(plainBuf)) as SerializedPacketChunkItem[];
  const out: CapturedPacket[] = [];
  for (const item of items) {
    const pkt = dissectRawIpPacket(hexToBytes(item.rawHex), {
      sequence: item.sequence,
      timestampNs: item.timestampNs,
      timestampMs: item.timestampMs,
      appId: item.appId,
      appName: item.appName,
      direction: item.direction,
      sourceOrigin: item.sourceOrigin,
      keylogEntries,
      firewallRules,
    });
    if (pkt) out.push(pkt);
  }
  return out;
}

export async function saveVaultSessionMeta(meta: VaultSessionMeta): Promise<void> {
  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveEncryptedChunk(chunk: EncryptedChunkRecord): Promise<void> {
  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_CHUNKS, 'readwrite');
    tx.objectStore(STORE_CHUNKS).put(chunk);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listVaultSessions(): Promise<VaultSessionMeta[]> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly');
    const req = tx.objectStore(STORE_META).getAll();
    req.onsuccess = () => {
      const list = (req.result as VaultSessionMeta[]) || [];
      list.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getSessionChunks(sessionId: string): Promise<EncryptedChunkRecord[]> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHUNKS, 'readonly');
    const idx = tx.objectStore(STORE_CHUNKS).index('sessionId');
    const req = idx.getAll(sessionId);
    req.onsuccess = () => {
      const list = (req.result as EncryptedChunkRecord[]) || [];
      list.sort((a, b) => a.chunkIndex - b.chunkIndex);
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearVaultStorage(): Promise<void> {
  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_CHUNKS, STORE_META], 'readwrite');
    tx.objectStore(STORE_CHUNKS).clear();
    tx.objectStore(STORE_META).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function createSaltBase64(): string {
  return u8ToB64(crypto.getRandomValues(new Uint8Array(16)));
}

export { b64ToU8, u8ToB64 };
