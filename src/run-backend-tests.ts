/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';

// Polyfill localStorage for Node.js test environment
if (typeof global.localStorage === 'undefined') {
  const storage = new Map<string, string>();
  (global as any).localStorage = {
    getItem: (key: string) => storage.get(key) || null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => { storage.clear(); },
    key: (index: number) => Array.from(storage.keys())[index] || null,
    get length() { return storage.size; }
  };
}

import { hashPassword, verifyPassword, computePunchHash, verifyPunchLedger, GENESIS_PUNCH_HASH } from './cryptoEngine';
import { atomicCloudWrite, getScrubbedCloudSyncPayload } from './aiAndCloudService';
import { detectScheduleConflicts } from './schedulerEngine';
import { getBistro313Preset } from './seedData';
import { OrganizationState, TimePunch } from './types';

// ==========================================
// ERROR CODE REGISTRY
// ==========================================
const ERROR_CODES = {
  ERR_CRYPTO_HASH_001: 'CRITICAL: Password hashing and verification mismatch.',
  ERR_CRYPTO_LEDGER_002: 'CRITICAL: Timecard cryptographic ledger chain integrity check failed.',
  ERR_SYNC_CHECKSUM_003: 'CRITICAL: Atomic cloud write SHA-256 checksum verification mismatch.',
  ERR_SYNC_PII_004: 'PRIVACY BREACH: Scrubbed cloud sync payload leaked sensitive PII (wages/salts/hashes).',
  ERR_SCHED_CONFLICT_005: 'LOGIC ERROR: Schedule conflict detection engine failed to flag overlapping shifts.',
};

async function runTests() {
  console.log('🧪 Starting Open Schedule Backend Test Suite...\n');
  let passedCount = 0;
  let failedCount = 0;

  // ---------------------------------------------------------------------------
  // TEST 1: Cryptographic Password Hashing & Verification
  // ---------------------------------------------------------------------------
  try {
    console.log('[TEST 1/5] Testing PBKDF2 Password Hashing & Verification...');
    const testPassword = 'SecureManagerPassword123!';
    const { hashHex, saltHex } = await hashPassword(testPassword);
    
    assert(hashHex && hashHex.length === 64, 'Generated hash must be a valid 64-char hex string');
    assert(saltHex && saltHex.length === 32, 'Generated salt must be a valid 32-char hex string');

    const isValid = await verifyPassword(testPassword, hashHex, saltHex);
    assert(isValid === true, 'Password verification must return true for correct password');

    const isInvalid = await verifyPassword('WrongPassword', hashHex, saltHex);
    assert(isInvalid === false, 'Password verification must return false for incorrect password');

    console.log('  ✅ TEST 1 PASSED: Password crypto verification successful.\n');
    passedCount++;
  } catch (err: any) {
    console.error(`  ❌ TEST 1 FAILED [ERR_CRYPTO_HASH_001]: ${ERROR_CODES.ERR_CRYPTO_HASH_001}`);
    console.error(`     Details: ${err.message}\n`);
    failedCount++;
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Timecard Cryptographic Ledger Hash-Chain Integrity
  // ---------------------------------------------------------------------------
  try {
    console.log('[TEST 2/5] Testing Timecard Ledger Hash-Chain Verification & Tamper Detection...');
    const nowIso = new Date().toISOString();
    const hash1 = await computePunchHash(GENESIS_PUNCH_HASH, 'emp_1', 'shift_1', 'clock_in', nowIso);
    const hash2 = await computePunchHash(hash1, 'emp_1', 'shift_1', 'clock_out', nowIso);

    const validPunches: TimePunch[] = [
      {
        id: 'p1',
        employeeId: 'emp_1',
        shiftId: 'shift_1',
        punchType: 'clock_in',
        timestampIso: nowIso,
        prevHash: GENESIS_PUNCH_HASH,
        hash: hash1,
        verifiedVia: 'pin',
        deviceId: 'dev_1',
      },
      {
        id: 'p2',
        employeeId: 'emp_1',
        shiftId: 'shift_1',
        punchType: 'clock_out',
        timestampIso: nowIso,
        prevHash: hash1,
        hash: hash2,
        verifiedVia: 'pin',
        deviceId: 'dev_1',
      },
    ];

    const auditClean = await verifyPunchLedger(validPunches);
    assert(auditClean.valid === true, 'Clean ledger must pass verification');

    const tamperedPunches = [...validPunches];
    tamperedPunches[1] = {
      ...tamperedPunches[1],
      timestampIso: new Date(Date.now() + 3600000).toISOString(),
      isTampered: true,
    };

    const auditTampered = await verifyPunchLedger(tamperedPunches);
    assert(auditTampered.valid === false, 'Tampered ledger must fail cryptographic verification');

    console.log('  ✅ TEST 2 PASSED: Timecard tamper detection operational.\n');
    passedCount++;
  } catch (err: any) {
    console.error(`  ❌ TEST 2 FAILED [ERR_CRYPTO_LEDGER_002]: ${ERROR_CODES.ERR_CRYPTO_LEDGER_002}`);
    console.error(`     Details: ${err.message}\n`);
    failedCount++;
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Atomic Cloud Write & Checksum Verification
  // ---------------------------------------------------------------------------
  try {
    console.log('[TEST 3/5] Testing Atomic Cloud Write & SHA-256 Checksum Integrity...');
    const mockState = getBistro313Preset();
    const writeResult = await atomicCloudWrite(mockState);

    assert(writeResult.success === true, 'Atomic cloud write must succeed');
    assert(writeResult.stagingChecksum === writeResult.mainChecksum, 'Staging and main SHA-256 checksums must match');

    console.log('  ✅ TEST 3 PASSED: Atomic backup checksum verified.\n');
    passedCount++;
  } catch (err: any) {
    console.error(`  ❌ TEST 3 FAILED [ERR_SYNC_CHECKSUM_003]: ${ERROR_CODES.ERR_SYNC_CHECKSUM_003}`);
    console.error(`     Details: ${err.message}\n`);
    failedCount++;
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Cloud Privacy Scrubbing (PII Protection)
  // ---------------------------------------------------------------------------
  try {
    console.log('[TEST 4/5] Testing Scrubbed Cloud Payload PII Strip (Privacy Guard)...');
    const mockState = getBistro313Preset();
    const scrubbed = getScrubbedCloudSyncPayload(mockState);

    const payloadString = JSON.stringify(scrubbed);
    assert(!payloadString.includes('baseHourlyRate'), 'Cloud payload must NOT contain hourly pay rates');
    assert(!payloadString.includes('passwordHash'), 'Cloud payload must NOT contain password hashes');
    assert(!payloadString.includes('saltHex'), 'Cloud payload must NOT contain salts');
    assert(!payloadString.includes('pinCode'), 'Cloud payload must NOT contain kiosk PINs');

    console.log('  ✅ TEST 4 PASSED: Zero PII detected in cloud sync payload.\n');
    passedCount++;
  } catch (err: any) {
    console.error(`  ❌ TEST 4 FAILED [ERR_SYNC_PII_004]: ${ERROR_CODES.ERR_SYNC_PII_004}`);
    console.error(`     Details: ${err.message}\n`);
    failedCount++;
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Schedule Conflict Detection Engine
  // ---------------------------------------------------------------------------
  try {
    console.log('[TEST 5/5] Testing Schedule Conflict Detection Engine...');
    const mockState = getBistro313Preset();
    const testEmpId = mockState.employees[0].id;
    const testDate = '2026-11-01';

    const overlappingShifts = [
      ...mockState.shifts,
      {
        id: 'shift_test_1',
        employeeId: testEmpId,
        roleId: mockState.roles[0].id,
        departmentId: mockState.departments[0].id,
        date: testDate,
        startTime: '08:00',
        endTime: '16:00',
        requiredTags: [],
        status: 'published' as const,
        isUpForGrabs: false,
      },
      {
        id: 'shift_test_2',
        employeeId: testEmpId,
        roleId: mockState.roles[0].id,
        departmentId: mockState.departments[0].id,
        date: testDate,
        startTime: '12:00',
        endTime: '20:00',
        requiredTags: [],
        status: 'published' as const,
        isUpForGrabs: false,
      },
    ];

    const conflicts = detectScheduleConflicts(
      overlappingShifts,
      mockState.employees,
      mockState.settings,
      mockState.timeOffRequests,
      mockState.availabilities
    );

    assert(conflicts.length > 0, 'Conflict detector must flag overlapping shifts for the same employee');

    console.log('  ✅ TEST 5 PASSED: Overlapping shift conflicts successfully flagged.\n');
    passedCount++;
  } catch (err: any) {
    console.error(`  ❌ TEST 5 FAILED [ERR_SCHED_CONFLICT_005]: ${ERROR_CODES.ERR_SCHED_CONFLICT_005}`);
    console.error(`     Details: ${err.message}\n`);
    failedCount++;
  }

  console.log('=========================================');
  console.log(`Test Execution Complete: ${passedCount} Passed, ${failedCount} Failed.`);
  console.log('=========================================');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
EOF\
cat << 'EOF' > src/run-backend-tests.ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';

// Polyfill localStorage for Node.js test environment
if (typeof global.localStorage === 'undefined') {
  const storage = new Map<string, string>();
  (global as any).localStorage = {
    getItem: (key: string) => storage.get(key) || null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => { storage.clear(); },
    key: (index: number) => Array.from(storage.keys())[index] || null,
    get length() { return storage.size; }
  };
}

import { hashPassword, verifyPassword, computePunchHash, verifyPunchLedger, GENESIS_PUNCH_HASH } from './cryptoEngine';
import { atomicCloudWrite, getScrubbedCloudSyncPayload } from './aiAndCloudService';
import { detectScheduleConflicts } from './schedulerEngine';
import { getBistro313Preset } from './seedData';
import { OrganizationState, TimePunch } from './types';

// ==========================================
// ERROR CODE REGISTRY
// ==========================================
const ERROR_CODES = {
  ERR_CRYPTO_HASH_001: 'CRITICAL: Password hashing and verification mismatch.',
  ERR_CRYPTO_LEDGER_002: 'CRITICAL: Timecard cryptographic ledger chain integrity check failed.',
  ERR_SYNC_CHECKSUM_003: 'CRITICAL: Atomic cloud write SHA-256 checksum verification mismatch.',
  ERR_SYNC_PII_004: 'PRIVACY BREACH: Scrubbed cloud sync payload leaked sensitive PII (wages/salts/hashes).',
  ERR_SCHED_CONFLICT_005: 'LOGIC ERROR: Schedule conflict detection engine failed to flag overlapping shifts.',
};

async function runTests() {
  console.log('🧪 Starting Open Schedule Backend Test Suite...\n');
  let passedCount = 0;
  let failedCount = 0;

  // ---------------------------------------------------------------------------
  // TEST 1: Cryptographic Password Hashing & Verification
  // ---------------------------------------------------------------------------
  try {
    console.log('[TEST 1/5] Testing PBKDF2 Password Hashing & Verification...');
    const testPassword = 'SecureManagerPassword123!';
    const { hashHex, saltHex } = await hashPassword(testPassword);
    
    assert(hashHex && hashHex.length === 64, 'Generated hash must be a valid 64-char hex string');
    assert(saltHex && saltHex.length === 32, 'Generated salt must be a valid 32-char hex string');

    const isValid = await verifyPassword(testPassword, hashHex, saltHex);
    assert(isValid === true, 'Password verification must return true for correct password');

    const isInvalid = await verifyPassword('WrongPassword', hashHex, saltHex);
    assert(isInvalid === false, 'Password verification must return false for incorrect password');

    console.log('  ✅ TEST 1 PASSED: Password crypto verification successful.\n');
    passedCount++;
  } catch (err: any) {
    console.error(`  ❌ TEST 1 FAILED [ERR_CRYPTO_HASH_001]: ${ERROR_CODES.ERR_CRYPTO_HASH_001}`);
    console.error(`     Details: ${err.message}\n`);
    failedCount++;
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Timecard Cryptographic Ledger Hash-Chain Integrity
  // ---------------------------------------------------------------------------
  try {
    console.log('[TEST 2/5] Testing Timecard Ledger Hash-Chain Verification & Tamper Detection...');
    const nowIso = new Date().toISOString();
    const hash1 = await computePunchHash(GENESIS_PUNCH_HASH, 'emp_1', 'shift_1', 'clock_in', nowIso);
    const hash2 = await computePunchHash(hash1, 'emp_1', 'shift_1', 'clock_out', nowIso);

    const validPunches: TimePunch[] = [
      {
        id: 'p1',
        employeeId: 'emp_1',
        shiftId: 'shift_1',
        punchType: 'clock_in',
        timestampIso: nowIso,
        prevHash: GENESIS_PUNCH_HASH,
        hash: hash1,
        verifiedVia: 'pin',
        deviceId: 'dev_1',
      },
      {
        id: 'p2',
        employeeId: 'emp_1',
        shiftId: 'shift_1',
        punchType: 'clock_out',
        timestampIso: nowIso,
        prevHash: hash1,
        hash: hash2,
        verifiedVia: 'pin',
        deviceId: 'dev_1',
      },
    ];

    const auditClean = await verifyPunchLedger(validPunches);
    assert(auditClean.valid === true, 'Clean ledger must pass verification');

    const tamperedPunches = [...validPunches];
    tamperedPunches[1] = {
      ...tamperedPunches[1],
      timestampIso: new Date(Date.now() + 3600000).toISOString(),
      isTampered: true,
    };

    const auditTampered = await verifyPunchLedger(tamperedPunches);
    assert(auditTampered.valid === false, 'Tampered ledger must fail cryptographic verification');

    console.log('  ✅ TEST 2 PASSED: Timecard tamper detection operational.\n');
    passedCount++;
  } catch (err: any) {
    console.error(`  ❌ TEST 2 FAILED [ERR_CRYPTO_LEDGER_002]: ${ERROR_CODES.ERR_CRYPTO_LEDGER_002}`);
    console.error(`     Details: ${err.message}\n`);
    failedCount++;
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Atomic Cloud Write & Checksum Verification
  // ---------------------------------------------------------------------------
  try {
    console.log('[TEST 3/5] Testing Atomic Cloud Write & SHA-256 Checksum Integrity...');
    const mockState = getBistro313Preset();
    const writeResult = await atomicCloudWrite(mockState);

    assert(writeResult.success === true, 'Atomic cloud write must succeed');
    assert(writeResult.stagingChecksum === writeResult.mainChecksum, 'Staging and main SHA-256 checksums must match');

    console.log('  ✅ TEST 3 PASSED: Atomic backup checksum verified.\n');
    passedCount++;
  } catch (err: any) {
    console.error(`  ❌ TEST 3 FAILED [ERR_SYNC_CHECKSUM_003]: ${ERROR_CODES.ERR_SYNC_CHECKSUM_003}`);
    console.error(`     Details: ${err.message}\n`);
    failedCount++;
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Cloud Privacy Scrubbing (PII Protection)
  // ---------------------------------------------------------------------------
  try {
    console.log('[TEST 4/5] Testing Scrubbed Cloud Payload PII Strip (Privacy Guard)...');
    const mockState = getBistro313Preset();
    const scrubbed = getScrubbedCloudSyncPayload(mockState);

    const payloadString = JSON.stringify(scrubbed);
    assert(!payloadString.includes('baseHourlyRate'), 'Cloud payload must NOT contain hourly pay rates');
    assert(!payloadString.includes('passwordHash'), 'Cloud payload must NOT contain password hashes');
    assert(!payloadString.includes('saltHex'), 'Cloud payload must NOT contain salts');
    assert(!payloadString.includes('pinCode'), 'Cloud payload must NOT contain kiosk PINs');

    console.log('  ✅ TEST 4 PASSED: Zero PII detected in cloud sync payload.\n');
    passedCount++;
  } catch (err: any) {
    console.error(`  ❌ TEST 4 FAILED [ERR_SYNC_PII_004]: ${ERROR_CODES.ERR_SYNC_PII_004}`);
    console.error(`     Details: ${err.message}\n`);
    failedCount++;
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Schedule Conflict Detection Engine
  // ---------------------------------------------------------------------------
  try {
    console.log('[TEST 5/5] Testing Schedule Conflict Detection Engine...');
    const mockState = getBistro313Preset();
    const testEmpId = mockState.employees[0].id;
    const testDate = '2026-11-01';

    const overlappingShifts = [
      ...mockState.shifts,
      {
        id: 'shift_test_1',
        employeeId: testEmpId,
        roleId: mockState.roles[0].id,
        departmentId: mockState.departments[0].id,
        date: testDate,
        startTime: '08:00',
        endTime: '16:00',
        requiredTags: [],
        status: 'published' as const,
        isUpForGrabs: false,
      },
      {
        id: 'shift_test_2',
        employeeId: testEmpId,
        roleId: mockState.roles[0].id,
        departmentId: mockState.departments[0].id,
        date: testDate,
        startTime: '12:00',
        endTime: '20:00',
        requiredTags: [],
        status: 'published' as const,
        isUpForGrabs: false,
      },
    ];

    const conflicts = detectScheduleConflicts(
      overlappingShifts,
      mockState.employees,
      mockState.settings,
      mockState.timeOffRequests,
      mockState.availabilities
    );

    assert(conflicts.length > 0, 'Conflict detector must flag overlapping shifts for the same employee');

    console.log('  ✅ TEST 5 PASSED: Overlapping shift conflicts successfully flagged.\n');
    passedCount++;
  } catch (err: any) {
    console.error(`  ❌ TEST 5 FAILED [ERR_SCHED_CONFLICT_005]: ${ERROR_CODES.ERR_SCHED_CONFLICT_005}`);
    console.error(`     Details: ${err.message}\n`);
    failedCount++;
  }

  console.log('=========================================');
  console.log(`Test Execution Complete: ${passedCount} Passed, ${failedCount} Failed.`);
  console.log('=========================================');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
