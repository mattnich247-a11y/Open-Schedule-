/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { TimePunch } from './types';

// Ensure crypto subtle is available across both modern browser and Node test environments
const subtle = globalThis.crypto?.subtle;

export const GENESIS_PUNCH_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Convert byte array to hexadecimal string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hexadecimal string to byte array
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.trim();
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Generate cryptographically secure random salt (default 16 bytes)
 */
export function generateSaltHex(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/**
 * PBKDF2 Password Hashing:
 * 100,000 iterations, 16-byte random salt, SHA-256
 */
export async function hashPassword(
  password: string,
  saltHex?: string
): Promise<{ hashHex: string; saltHex: string }> {
  const salt = saltHex ? hexToBytes(saltHex) : globalThis.crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  const derivedBits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256 // 32 bytes (256 bits)
  );

  const hashHex = bytesToHex(new Uint8Array(derivedBits));
  return {
    hashHex,
    saltHex: bytesToHex(salt),
  };
}

/**
 * Verify plaintext password against PBKDF2 hash & salt
 */
export async function verifyPassword(
  password: string,
  storedHashHex: string,
  storedSaltHex: string
): Promise<boolean> {
  const result = await hashPassword(password, storedSaltHex);
  return result.hashHex === storedHashHex;
}

/**
 * Derive AES-GCM Key from a master passphrase using PBKDF2
 */
async function deriveAesKey(passphrase: string, saltBytes: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return await subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * AES-256-GCM Vault Encryption
 */
export async function encryptVault(
  plainText: string,
  passphrase: string
): Promise<{ ciphertextHex: string; ivHex: string; saltHex: string }> {
  const saltBytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const ivBytes = globalThis.crypto.getRandomValues(new Uint8Array(12)); // 96-bit standard IV for GCM
  const aesKey = await deriveAesKey(passphrase, saltBytes);

  const enc = new TextEncoder();
  const cipherBuffer = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes as BufferSource,
    },
    aesKey,
    enc.encode(plainText)
  );

  return {
    ciphertextHex: bytesToHex(new Uint8Array(cipherBuffer)),
    ivHex: bytesToHex(ivBytes),
    saltHex: bytesToHex(saltBytes),
  };
}

/**
 * AES-256-GCM Vault Decryption
 */
export async function decryptVault(
  ciphertextHex: string,
  ivHex: string,
  saltHex: string,
  passphrase: string
): Promise<string> {
  const saltBytes = hexToBytes(saltHex);
  const ivBytes = hexToBytes(ivHex);
  const ciphertextBytes = hexToBytes(ciphertextHex);
  const aesKey = await deriveAesKey(passphrase, saltBytes);

  const plainBuffer = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes as BufferSource,
    },
    aesKey,
    ciphertextBytes as BufferSource
  );

  const dec = new TextDecoder();
  return dec.decode(plainBuffer);
}

/**
 * Compute SHA-256 Punch Hash for Tamper-Evident Ledger:
 * prevHash + employeeId + shiftId + punchType + timestampIso
 */
export async function computePunchHash(
  prevHash: string,
  employeeId: string,
  shiftId: string | null,
  punchType: string,
  timestampIso: string
): Promise<string> {
  const rawString = `${prevHash}|${employeeId}|${shiftId || 'none'}|${punchType}|${timestampIso}`;
  const enc = new TextEncoder();
  const digestBuffer = await subtle.digest('SHA-256', enc.encode(rawString));
  return bytesToHex(new Uint8Array(digestBuffer));
}

/**
 * Verify Complete Punch Ledger
 * Pinpoints tampered rows if hashes don't match
 */
export async function verifyPunchLedger(
  punches: TimePunch[]
): Promise<{ valid: boolean; brokenIndex: number | null; details?: string }> {
  if (!punches || punches.length === 0) {
    return { valid: true, brokenIndex: null, details: 'Ledger is empty (valid).' };
  }

  let expectedPrevHash = GENESIS_PUNCH_HASH;

  for (let i = 0; i < punches.length; i++) {
    const p = punches[i];

    // Check prevHash continuity
    if (p.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        brokenIndex: i,
        details: `Broken hash link at entry #${i + 1} (${p.employeeId}). Previous hash does not match prior record.`,
      };
    }

    // Recompute current punch hash
    const recomputedHash = await computePunchHash(
      p.prevHash,
      p.employeeId,
      p.shiftId,
      p.punchType,
      p.timestampIso
    );

    if (recomputedHash !== p.hash || p.isTampered) {
      return {
        valid: false,
        brokenIndex: i,
        details: `Tamper detected at entry #${i + 1} (${p.punchType} at ${p.timestampIso}). Hash mismatch!`,
      };
    }

    expectedPrevHash = p.hash;
  }

  return { valid: true, brokenIndex: null, details: `All ${punches.length} ledger entries cryptographically verified.` };
}

/**
 * Re-calculate valid cryptographic hashes sequentially across the entire ledger,
 * clearing any tampered states. Protected by manager password verification.
 */
export async function repairAndRecalculatePunchLedger(
  punches: TimePunch[]
): Promise<TimePunch[]> {
  let prevHash = GENESIS_PUNCH_HASH;
  const repaired: TimePunch[] = [];

  for (const p of punches) {
    const validHash = await computePunchHash(
      prevHash,
      p.employeeId,
      p.shiftId,
      p.punchType,
      p.timestampIso
    );
    repaired.push({
      ...p,
      prevHash,
      hash: validHash,
      isTampered: false,
    });
    prevHash = validHash;
  }

  return repaired;
}

/**
 * Generate rolling 120-second (2-minute) HMAC-SHA256 TOTP presence verification code (4 or 6 digits)
 */
export async function generateRollingTotp(
  secretHex: string,
  digits: 4 | 6 = 6,
  timeStepSeconds = 120,
  targetTimestampMs = Date.now()
): Promise<{ code: string; remainingSeconds: number; timeWindow: number }> {
  const timeWindow = Math.floor(targetTimestampMs / 1000 / timeStepSeconds);
  const remainingSeconds = timeStepSeconds - (Math.floor(targetTimestampMs / 1000) % timeStepSeconds);

  // Convert time window integer to 8-byte buffer
  const timeBuffer = new ArrayBuffer(8);
  const dataView = new DataView(timeBuffer);
  dataView.setBigUint64(0, BigInt(timeWindow));

  const keyBytes = hexToBytes(secretHex.padEnd(64, '0').slice(0, 64));
  const cryptoKey = await subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await subtle.sign('HMAC', cryptoKey, timeBuffer);
  const sigBytes = new Uint8Array(signature);

  // Dynamic truncation (RFC 6238 / 4226)
  const offset = sigBytes[sigBytes.length - 1] & 0x0f;
  const binary =
    ((sigBytes[offset] & 0x7f) << 24) |
    ((sigBytes[offset + 1] & 0xff) << 16) |
    ((sigBytes[offset + 2] & 0xff) << 8) |
    (sigBytes[offset + 3] & 0xff);

  const modulo = digits === 4 ? 10000 : 1000000;
  const otpNumber = binary % modulo;
  const code = otpNumber.toString().padStart(digits, '0');

  return { code, remainingSeconds, timeWindow };
}

/**
 * Verify rolling TOTP code (checks current window, plus 1 window grace in case of clock drift)
 */
export async function verifyRollingTotp(
  inputCode: string,
  secretHex: string,
  digits: 4 | 6 = 6,
  timeStepSeconds = 120
): Promise<boolean> {
  const now = Date.now();
  const cleanInput = inputCode.trim();

  // Check current window, previous window (-120s), and next window (+120s)
  const offsets = [0, -timeStepSeconds * 1000, timeStepSeconds * 1000];
  for (const offset of offsets) {
    const { code } = await generateRollingTotp(secretHex, digits, timeStepSeconds, now + offset);
    if (code === cleanInput) {
      return true;
    }
  }

  return false;
}

/**
 * Haversine formula: Calculates distance between two GPS coordinates in meters
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Get or generate persistent unique device identifier for Anti-Buddy-Punch checks
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server-or-test-device';
  let deviceId = localStorage.getItem('openschedule_device_id');
  if (!deviceId) {
    deviceId = 'dev_' + generateSaltHex(8);
    localStorage.setItem('openschedule_device_id', deviceId);
  }
  return deviceId;
}
