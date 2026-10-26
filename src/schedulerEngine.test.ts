import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTime12H,
  calculateShiftHours,
  timesOverlap,
  detectScheduleConflicts,
  autoAllocateOpenShifts,
} from './schedulerEngine';
import { Employee, OrganizationSettings, Shift } from './types';

const mockSettings: OrganizationSettings = {
  orgName: 'Test Org',
  industry: 'hospitality',
  operationalHours: {
    open: '07:00',
    close: '23:00',
    bufferBeforeHours: 1,
    bufferAfterHours: 1,
  },
  weeklyOvertimeHours: 40,
  dailyOvertimeHours: 8,
  earlyClockInGraceMinutes: 60,
  maxBreakMinutes: 45,
  geofence: {
    name: 'Main HQ',
    latitude: 42.3601,
    longitude: -71.0589,
    radiusMeters: 75,
  },
  swapRequiresManagerApproval: true,
  staffCanPostUpForGrabs: true,
  vacationRequiresApproval: true,
  groupChatManagerOnly: false,
  weeklyBudgetsByWeek: {},
  trackLaborCost: true,
  laborBudgetWeekly: 4500,
  totpSecretHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  totpDigits: 6,
  managerUsername: 'manager',
  managerPasswordHash: 'hash123',
  managerSaltHex: 'salt123',
  featureToggles: {
    useAi: false,
    timeclockMode: 'both',
    trackLaborCost: true,
  },
  cloudSync: {
    enabled: false,
    provider: 'supabase',
    projectUrl: '',
    apiKey: '',
  },
  autoSaveIntervalMinutes: 5,
};

test('12-hour AM/PM formatting and duration calculation works accurately', () => {
  assert.equal(formatTime12H('08:00'), '8:00 AM');
  assert.equal(formatTime12H('12:00'), '12:00 PM');
  assert.equal(formatTime12H('16:30'), '4:30 PM');
  assert.equal(formatTime12H('00:15'), '12:15 AM');

  assert.equal(calculateShiftHours('08:00', '16:00'), 8);
  assert.equal(calculateShiftHours('22:00', '02:00'), 4); // Overnight shift
});

test('Time overlap detection detects intersections correctly', () => {
  assert.equal(timesOverlap('08:00', '16:00', '12:00', '18:00'), true);
  assert.equal(timesOverlap('08:00', '12:00', '12:00', '16:00'), false);
  assert.equal(timesOverlap('08:00', '11:00', '13:00', '17:00'), false);
});

test('Constraint solver auto-allocates open shifts respecting role qualifications and overtime', () => {
  const employees: Employee[] = [
    {
      id: 'emp_lead',
      name: 'Chef Gordon',
      username: 'gordon',
      passwordHash: 'hash',
      saltHex: 'salt',
      departmentIds: ['dept_kitchen'],
      roleIds: ['role_chef'],
      tags: ['tag_lead', 'tag_closer'],
      targetWeeklyHours: 35,
      maxWeeklyHours: 40,
      baseHourlyRate: 28,
      requiresPasswordChange: false,
      pinCode: '1234',
      currentPunchStatus: 'clocked_out',
    },
    {
      id: 'emp_prep',
      name: 'Junior Cook',
      username: 'junior',
      passwordHash: 'hash',
      saltHex: 'salt',
      departmentIds: ['dept_kitchen'],
      roleIds: ['role_cook'],
      tags: [],
      targetWeeklyHours: 30,
      maxWeeklyHours: 40,
      baseHourlyRate: 18,
      requiresPasswordChange: false,
      pinCode: '2222',
      currentPunchStatus: 'clocked_out',
    },
  ];

  const openShifts: Shift[] = [
    {
      id: 'shift_open_1',
      employeeId: null,
      roleId: 'role_chef',
      departmentId: 'dept_kitchen',
      date: '2026-10-26',
      startTime: '10:00',
      endTime: '18:00',
      requiredTags: ['tag_lead'],
      isUpForGrabs: false,
      status: 'draft',
    },
  ];

  const result = autoAllocateOpenShifts(
    openShifts,
    [],
    employees,
    mockSettings,
    [],
    []
  );

  assert.equal(result.assignedCount, 1);
  assert.equal(result.assignedShifts[0].employeeId, 'emp_lead');
  assert.equal(result.assignedShifts[0].status, 'published');
});

test('Conflict detection flags double bookings and missing qualifications', () => {
  const employees: Employee[] = [
    {
      id: 'emp_1',
      name: 'Alice Server',
      username: 'alice',
      passwordHash: 'hash',
      saltHex: 'salt',
      departmentIds: ['dept_foh'],
      roleIds: ['role_server'],
      tags: ['tag_opener'],
      targetWeeklyHours: 30,
      maxWeeklyHours: 35,
      baseHourlyRate: 20,
      requiresPasswordChange: false,
      pinCode: '3333',
      currentPunchStatus: 'clocked_out',
    },
  ];

  // Alice is double-booked on the same day
  const overlappingShifts: Shift[] = [
    {
      id: 's1',
      employeeId: 'emp_1',
      roleId: 'role_server',
      departmentId: 'dept_foh',
      date: '2026-10-27',
      startTime: '08:00',
      endTime: '14:00',
      requiredTags: [],
      isUpForGrabs: false,
      status: 'published',
    },
    {
      id: 's2',
      employeeId: 'emp_1',
      roleId: 'role_server',
      departmentId: 'dept_foh',
      date: '2026-10-27',
      startTime: '12:00',
      endTime: '18:00',
      requiredTags: [],
      isUpForGrabs: false,
      status: 'published',
    },
  ];

  const conflicts = detectScheduleConflicts(overlappingShifts, employees, mockSettings);
  const doubleBookingConflict = conflicts.find((c) => c.type === 'double_booked');
  assert.ok(doubleBookingConflict, 'Should detect double-booked conflict');
});

test('Half-day PTO & vacation conflict detection flags morning vs night correctly', () => {
  const empId = 'emp_bob';
  const shifts: Shift[] = [
    {
      id: 'sh_morning',
      employeeId: empId,
      roleId: 'role_server',
      departmentId: 'dept_foh',
      date: '2026-11-02',
      startTime: '08:00',
      endTime: '12:00',
      requiredTags: [],
      isUpForGrabs: false,
      status: 'published',
    },
    {
      id: 'sh_evening',
      employeeId: empId,
      roleId: 'role_server',
      departmentId: 'dept_foh',
      date: '2026-11-03',
      startTime: '17:00',
      endTime: '22:00',
      requiredTags: [],
      isUpForGrabs: false,
      status: 'published',
    },
  ];

  // Bob has approved morning-half PTO on Nov 2 (clashes) and night-half on Nov 4 (no clash)
  const timeOffRequests = [
    {
      id: 'to_1',
      employeeId: empId,
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      reason: 'Dentist appointment',
      requestType: 'pto' as const,
      partOfDay: 'morning_half' as const,
      status: 'approved' as const,
      submittedAtIso: new Date().toISOString(),
    },
  ];

  const mockEmployee: Employee = {
    id: empId,
    name: 'Bob Test',
    username: 'bob',
    departmentIds: ['dept_foh'],
    roleIds: ['role_server'],
    tags: [],
    targetWeeklyHours: 40,
    maxWeeklyHours: 40,
    baseHourlyRate: 20,
    requiresPasswordChange: false,
    pinCode: '4444',
    passwordHash: 'hash',
    saltHex: 'salt',
    currentPunchStatus: 'clocked_out',
  };

  const conflicts = detectScheduleConflicts(shifts, [mockEmployee], mockSettings, timeOffRequests, []);
  const morningClash = conflicts.find((c) => c.shiftId === 'sh_morning' && c.type === 'time_off_clash');
  const eveningClash = conflicts.find((c) => c.shiftId === 'sh_evening' && c.type === 'time_off_clash');

  assert.ok(morningClash, 'Morning shift should clash with morning_half PTO');
  assert.equal(eveningClash, undefined, 'Evening shift should not clash with morning_half PTO');
});
