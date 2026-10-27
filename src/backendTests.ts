/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_CODES, Employee, Shift, TimeOffRequest } from './types';
import {
  authenticateUser,
  validateUniquePin,
  evaluateScheduleConflicts,
  createTamperEvidentPunch,
  verifyPunchLedger,
  postShiftUpForGrabs,
  reclaimShiftUpForGrabs,
} from './cryptoEngine';

const mockEmployees: Employee[] = [
  {
    id: 'emp-1',
    name: 'Alice Rivera',
    username: 'alice',
    pin: '1234',
    roleIds: ['role-1'],
    departmentId: 'dept-1',
    baseHourlyRate: 22,
    maxWeeklyHours: 40,
    skills: ['Barista', 'Opening'],
    colorHex: '#059669',
  },
  {
    id: 'emp-2',
    name: 'Marcus Vance',
    username: 'marcus',
    pin: '5678',
    roleIds: ['role-1'],
    departmentId: 'dept-1',
    baseHourlyRate: 20,
    maxWeeklyHours: 40,
    skills: ['Closing'],
    colorHex: '#2563EB',
  },
];

test('1. Authentication & Stateless Demo Mode (ERR_AUTH_INVALID_CREDENTIALS)', () => {
  const demoAuth = authenticateUser('demo', 'demomode', mockEmployees);
  assert.equal(demoAuth.mode, 'demo');

  const validAuth = authenticateUser('alice', '1234', mockEmployees);
  assert.equal(validAuth.mode, 'authenticated');
  assert.equal(validAuth.employee?.id, 'emp-1');

  assert.throws(
    () => authenticateUser('alice', '9999', mockEmployees),
    new RegExp(ERROR_CODES.ERR_AUTH_INVALID_CREDENTIALS)
  );
});

test('2. Unique 4-Digit PIN Enforcement (ERR_DUPLICATE_PIN)', () => {
  const dupResult = validateUniquePin('1234', mockEmployees);
  assert.equal(dupResult.valid, false);
  assert.equal(dupResult.error, ERROR_CODES.ERR_DUPLICATE_PIN);

  const uniqueResult = validateUniquePin('9012', mockEmployees);
  assert.equal(uniqueResult.valid, true);
});

test('3. Double-Booked Shift Detection (ERR_SHIFT_DOUBLE_BOOKED)', () => {
  const shifts: Shift[] = [
    {
      id: 's-1',
      employeeId: 'emp-1',
      roleId: 'role-1',
      date: '2026-10-28',
      startTime: '08:00',
      endTime: '14:00',
      status: 'published',
    },
    {
      id: 's-2',
      employeeId: 'emp-1',
      roleId: 'role-1',
      date: '2026-10-28',
      startTime: '12:00',
      endTime: '18:00',
      status: 'published',
    },
  ];

  const conflicts = evaluateScheduleConflicts(shifts, mockEmployees, []);
  assert.ok(conflicts.some((c) => c.code === ERROR_CODES.ERR_SHIFT_DOUBLE_BOOKED));
});

test('4. Vacation & Partial-Day PTO Conflict Detection (ERR_VACATION_CONFLICT)', () => {
  const pto: TimeOffRequest[] = [
    {
      id: 'pto-1',
      employeeId: 'emp-1',
      startDate: '2026-10-29',
      endDate: '2026-10-29',
      period: 'morning_half', // Until 13:00
      reason: 'Dental Appointment',
      status: 'approved',
      createdAt: '2026-10-20T10:00:00Z',
    },
  ];

  const morningShift: Shift[] = [
    {
      id: 's-morning',
      employeeId: 'emp-1',
      roleId: 'role-1',
      date: '2026-10-29',
      startTime: '09:00',
      endTime: '15:00',
      status: 'published',
    },
  ];

  const conflicts = evaluateScheduleConflicts(morningShift, mockEmployees, pto);
  assert.ok(conflicts.some((c) => c.code === ERROR_CODES.ERR_VACATION_CONFLICT));
});

test('5. Weekly Overtime Breach Detection (ERR_OVERTIME_BREACH)', () => {
  const shifts: Shift[] = [1, 2, 3, 4, 5].map((day) => ({
    id: `s-ot-${day}`,
    employeeId: 'emp-1',
    roleId: 'role-1',
    date: `2026-11-0${day}`,
    startTime: '08:00',
    endTime: '17:00', // 9 hours/day * 5 = 45 hours (> 40h limit)
    status: 'published',
  }));

  const conflicts = evaluateScheduleConflicts(shifts, mockEmployees, [], 40);
  assert.ok(conflicts.some((c) => c.code === ERROR_CODES.ERR_OVERTIME_BREACH));
});

test('6. Tamper-Evident Time Punch Ledger (ERR_LEDGER_HASH_MISMATCH)', async () => {
  const p1 = await createTamperEvidentPunch(
    {
      id: 'punch-1',
      employeeId: 'emp-1',
      type: 'clock_in',
      timestamp: '2026-10-28T08:00:00Z',
    },
    'GENESIS'
  );

  const p2 = await createTamperEvidentPunch(
    {
      id: 'punch-2',
      employeeId: 'emp-1',
      type: 'clock_out',
      timestamp: '2026-10-28T17:30:00Z',
      effectiveTimestamp: '2026-10-28T16:00:00Z',
      isRetroactive: true,
      retroactiveReason: 'Forgot to clock out at 4 PM',
    },
    p1.hash
  );

  const isValid = await verifyPunchLedger([p1, p2]);
  assert.equal(isValid, true);

  // Tamper with p2 effectiveTimestamp
  const tamperedP2 = { ...p2, effectiveTimestamp: '2026-10-28T18:00:00Z' };
  await assert.rejects(
    async () => verifyPunchLedger([p1, tamperedP2]),
    new RegExp(ERROR_CODES.ERR_LEDGER_HASH_MISMATCH)
  );
});

test('7. Shift Reclamation ("Claim Back") Workflow', () => {
  const baseShift: Shift = {
    id: 's-10',
    employeeId: 'emp-1',
    roleId: 'role-1',
    date: '2026-10-30',
    startTime: '10:00',
    endTime: '18:00',
    status: 'published',
  };

  const posted = postShiftUpForGrabs(baseShift);
  assert.equal(posted.upForGrabs, true);
  assert.equal(posted.originalOwnerId, 'emp-1');

  const reclaimed = reclaimShiftUpForGrabs(posted, 'emp-1');
  assert.equal(reclaimed.upForGrabs, false);
  assert.equal(reclaimed.employeeId, 'emp-1');
});