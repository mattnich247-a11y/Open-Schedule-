import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
  encryptVault,
  decryptVault,
  computePunchHash,
  verifyPunchLedger,
  generateRollingTotp,
  verifyRollingTotp,
  calculateHaversineDistanceMeters,
  GENESIS_PUNCH_HASH,
  repairAndRecalculatePunchLedger,
} from './cryptoEngine';
import { TimePunch } from './types';

test('PBKDF2 hashing generates valid salt and verifies password accurately', async () => {
  const password = 'SecretPassword123!';
  const { hashHex, saltHex } = await hashPassword(password);

  assert.ok(hashHex.length === 64, 'SHA-256 hash output should be 64 hex characters');
  assert.ok(saltHex.length === 32, '16-byte salt should be 32 hex characters');

  const isValid = await verifyPassword(password, hashHex, saltHex);
  assert.equal(isValid, true, 'Correct password must verify');

  const isInvalid = await verifyPassword('WrongPassword', hashHex, saltHex);
  assert.equal(isInvalid, false, 'Wrong password must fail');
});

test('AES-256-GCM encrypts and decrypts sensitive vault data without loss', async () => {
  const secretData = JSON.stringify({ employeeRate: 28.5, apiKey: 'sk-prod-test-key-999' });
  const passphrase = 'ManagerVaultKeyPassphrase!';

  const encrypted = await encryptVault(secretData, passphrase);
  assert.ok(encrypted.ciphertextHex.length > 0);
  assert.ok(encrypted.ivHex.length === 24, '12-byte IV should be 24 hex characters');

  const decrypted = await decryptVault(
    encrypted.ciphertextHex,
    encrypted.ivHex,
    encrypted.saltHex,
    passphrase
  );

  assert.equal(decrypted, secretData);
});

test('Tamper-evident punch ledger validates clean chain and pinpoints tampered record', async () => {
  const punch1Time = '2026-10-25T08:00:00Z';
  const hash1 = await computePunchHash(
    GENESIS_PUNCH_HASH,
    'emp_1',
    'shift_101',
    'clock_in',
    punch1Time
  );

  const punch2Time = '2026-10-25T16:00:00Z';
  const hash2 = await computePunchHash(
    hash1,
    'emp_1',
    'shift_101',
    'clock_out',
    punch2Time
  );

  const validLedger: TimePunch[] = [
    {
      id: 'p1',
      employeeId: 'emp_1',
      shiftId: 'shift_101',
      punchType: 'clock_in',
      timestampIso: punch1Time,
      prevHash: GENESIS_PUNCH_HASH,
      hash: hash1,
      latitude: 42.3601,
      longitude: -71.0589,
      accuracyMeters: 10,
      verifiedVia: 'gps',
      deviceId: 'dev_1',
    },
    {
      id: 'p2',
      employeeId: 'emp_1',
      shiftId: 'shift_101',
      punchType: 'clock_out',
      timestampIso: punch2Time,
      prevHash: hash1,
      hash: hash2,
      latitude: 42.3601,
      longitude: -71.0589,
      accuracyMeters: 12,
      verifiedVia: 'gps',
      deviceId: 'dev_1',
    },
  ];

  const verification = await verifyPunchLedger(validLedger);
  assert.equal(verification.valid, true);
  assert.equal(verification.brokenIndex, null);

  // Now simulate a database tamper attack (modifying clock out time by 1 hour)
  const tamperedLedger: TimePunch[] = [
    validLedger[0],
    {
      ...validLedger[1],
      timestampIso: '2026-10-25T17:00:00Z', // TAMPERED!
    },
  ];

  const tamperedResult = await verifyPunchLedger(tamperedLedger);
  assert.equal(tamperedResult.valid, false, 'Tampered ledger must be flagged invalid');
  assert.equal(tamperedResult.brokenIndex, 1, 'Should pinpoint index 1 as tampered');

  // Verify repairAndRecalculatePunchLedger fixes the chain
  const repaired = await repairAndRecalculatePunchLedger(tamperedLedger);
  const repairedVerification = await verifyPunchLedger(repaired);
  assert.equal(repairedVerification.valid, true, 'Repaired ledger must verify valid');
});

test('Rolling HMAC-SHA256 TOTP generates digits and validates correctly', async () => {
  const secretHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const totp4 = await generateRollingTotp(secretHex, 4);
  assert.equal(totp4.code.length, 4);

  const totp6 = await generateRollingTotp(secretHex, 6);
  assert.equal(totp6.code.length, 6);

  const verified = await verifyRollingTotp(totp6.code, secretHex, 6);
  assert.equal(verified, true);

  const fakeVerified = await verifyRollingTotp('999999', secretHex, 6);
  assert.equal(fakeVerified, false);
});

test('Haversine distance calculation is accurate within meters', () => {
  // Downtown Boston coordinates: ~111m apart
  const lat1 = 42.3601;
  const lon1 = -71.0589;
  const lat2 = 42.3610;
  const lon2 = -71.0589;

  const distance = calculateHaversineDistanceMeters(lat1, lon1, lat2, lon2);
  assert.ok(distance > 90 && distance < 120, `Distance was ${distance}`);
});
