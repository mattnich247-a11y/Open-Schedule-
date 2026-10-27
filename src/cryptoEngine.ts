/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AppState,
  Employee,
  EMPLOYEE_COLOR_PALETTE,
  ERROR_CODES,
  ScheduleConflict,
  Shift,
  TimeOffRequest,
  TimePunch,
} from './types';

/**
 * Deterministic color assignment for employees
 */
export function assignEmployeeColor(indexOrId: number | string): string {
  if (typeof indexOrId === 'number') {
    return EMPLOYEE_COLOR_PALETTE[Math.abs(indexOrId) % EMPLOYEE_COLOR_PALETTE.length];
  }
  let hash = 0;
  for (let i = 0; i < indexOrId.length; i++) {
    hash = (hash << 5) - hash + indexOrId.charCodeAt(i);
    hash |= 0;
  }
  return EMPLOYEE_COLOR_PALETTE[Math.abs(hash) % EMPLOYEE_COLOR_PALETTE.length];
}

/**
 * Validate 4-digit PIN uniqueness across all employees
 */
export function validateUniquePin(
  pin: string,
  employees: Employee[],
  excludeEmployeeId?: string
): { valid: boolean; error?: string } {
  if (!/^\d{4}$/.test(pin)) {
    return { valid: false, error: 'PIN must be exactly 4 digits.' };
  }
  const duplicate = employees.find(
    (emp) => emp.pin === pin && emp.id !== excludeEmployeeId
  );
  if (duplicate) {
    return { valid: false, error: ERROR_CODES.ERR_DUPLICATE_PIN };
  }
  return { valid: true };
}

/**
 * Authenticate user or handle stateless demomode
 */
export function authenticateUser(
  username: string,
  secret: string,
  employees: Employee[]
): { mode: 'demo' | 'authenticated'; employee?: Employee } {
  if (username.trim().toLowerCase() === 'demo' && secret === 'demomode') {
    return { mode: 'demo' };
  }
  const matched = employees.find(
    (e) =>
      e.username.toLowerCase() === username.trim().toLowerCase() &&
      e.pin === secret.trim()
  );
  if (!matched) {
    throw new Error(ERROR_CODES.ERR_AUTH_INVALID_CREDENTIALS);
  }
  return { mode: 'authenticated', employee: matched };
}

/**
 * Calculate duration in hours between HH:mm strings
 */
export function calculateShiftHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let startMinutes = sh * 60 + sm;
  let endMinutes = eh * 60 + em;
  if (endMinutes <= startMinutes) {
    endMinutes += 24 * 60; // Overnight shift support
  }
  return (endMinutes - startMinutes) / 60;
}

/**
 * Check if two time ranges (HH:mm) overlap
 */
export function doTimesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const sA = toMin(startA);
  let eA = toMin(endA);
  if (eA <= sA) eA += 1440;

  const sB = toMin(startB);
  let eB = toMin(endB);
  if (eB <= sB) eB += 1440;

  return sA < eB && sB < eA;
}

/**
 * Check if a shift conflicts with an approved TimeOffRequest (including partial days)
 */
export function checkVacationConflict(
  shift: Pick<Shift, 'employeeId' | 'date' | 'startTime' | 'endTime'>,
  timeOffRequests: TimeOffRequest[]
): TimeOffRequest | null {
  if (!shift.employeeId) return null;

  for (const req of timeOffRequests) {
    if (
      req.employeeId === shift.employeeId &&
      req.status === 'approved' &&
      shift.date >= req.startDate &&
      shift.date <= req.endDate
    ) {
      if (req.period === 'full') {
        return req;
      }
      if (req.period === 'morning_half') {
        // Morning half covers 00:00 to 13:00
        if (doTimesOverlap(shift.startTime, shift.endTime, '00:00', '13:00')) {
          return req;
        }
      }
      if (req.period === 'night_half') {
        // Night half covers 13:00 to 23:59
        if (doTimesOverlap(shift.startTime, shift.endTime, '13:00', '23:59')) {
          return req;
        }
      }
    }
  }
  return null;
}

/**
 * Validate a shift assignment and detect all schedule conflicts
 */
export function evaluateScheduleConflicts(
  shifts: Shift[],
  employees: Employee[],
  timeOffRequests: TimeOffRequest[],
  weeklyOvertimeLimit: number = 40
): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const hoursByEmployee = new Map<string, number>();

  // 1. Check double-booking & vacation conflicts
  for (let i = 0; i < shifts.length; i++) {
    const s1 = shifts[i];
    if (!s1.employeeId) continue;

    const emp = empMap.get(s1.employeeId);
    const hrs = calculateShiftHours(s1.startTime, s1.endTime);
    hoursByEmployee.set(
      s1.employeeId,
      (hoursByEmployee.get(s1.employeeId) || 0) + hrs
    );

    // Vacation conflict check
    const ptoConflict = checkVacationConflict(s1, timeOffRequests);
    if (ptoConflict) {
      conflicts.push({
        id: `conflict-pto-${s1.id}`,
        type: 'vacation_conflict',
        code: ERROR_CODES.ERR_VACATION_CONFLICT,
        shiftId: s1.id,
        employeeId: s1.employeeId,
        message: `${emp?.name || s1.employeeId} has approved PTO (${ptoConflict.period.replace('_', ' ')}) on ${s1.date}.`,
      });
    }

    // Double booking check
    for (let j = i + 1; j < shifts.length; j++) {
      const s2 = shifts[j];
      if (
        s1.employeeId === s2.employeeId &&
        s1.date === s2.date &&
        doTimesOverlap(s1.startTime, s1.endTime, s2.startTime, s2.endTime)
      ) {
        conflicts.push({
          id: `conflict-db-${s1.id}-${s2.id}`,
          type: 'double_booked',
          code: ERROR_CODES.ERR_SHIFT_DOUBLE_BOOKED,
          shiftId: s2.id,
          employeeId: s1.employeeId,
          message: `${emp?.name || s1.employeeId} is double-booked on ${s1.date} (${s1.startTime}-${s1.endTime} & ${s2.startTime}-${s2.endTime}).`,
        });
      }
    }
  }

  // 2. Check overtime breaches
  for (const [empId, totalHours] of hoursByEmployee.entries()) {
    const emp = empMap.get(empId);
    const threshold = emp
      ? Math.min(emp.maxWeeklyHours, weeklyOvertimeLimit)
      : weeklyOvertimeLimit;
    if (totalHours > threshold) {
      conflicts.push({
        id: `conflict-ot-${empId}`,
        type: 'overtime_breach',
        code: ERROR_CODES.ERR_OVERTIME_BREACH,
        employeeId: empId,
        message: `${emp?.name || empId} is scheduled for ${totalHours.toFixed(1)}h (exceeds ${threshold}h limit).`,
      });
    }
  }

  return conflicts;
}

/**
 * Post a shift "Up for Grabs" or reclaim it ("Claim Back")
 */
export function postShiftUpForGrabs(shift: Shift): Shift {
  return {
    ...shift,
    upForGrabs: true,
    originalOwnerId: shift.employeeId,
  };
}

export function reclaimShiftUpForGrabs(shift: Shift, requestingEmployeeId: string): Shift {
  if (!shift.upForGrabs || shift.originalOwnerId !== requestingEmployeeId) {
    throw new Error('Only the original shift owner can reclaim this shift.');
  }
  return {
    ...shift,
    upForGrabs: false,
    employeeId: requestingEmployeeId,
    originalOwnerId: null,
  };
}

/**
 * SHA-256 Hash helper using Web Crypto API (works in Browser and Node 18+)
 */
export async function computeSha256(payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Create a tamper-evident TimePunch (supports retroactive clock-out)
 */
export async function createTamperEvidentPunch(
  params: {
    id: string;
    employeeId: string;
    type: TimePunch['type'];
    timestamp: string;
    effectiveTimestamp?: string;
    isRetroactive?: boolean;
    retroactiveReason?: string;
  },
  previousHash: string = 'GENESIS'
): Promise<TimePunch> {
  const effective = params.effectiveTimestamp || params.timestamp;
  const canonicalString = `${params.id}|${params.employeeId}|${params.type}|${params.timestamp}|${effective}|${Boolean(params.isRetroactive)}|${previousHash}`;
  const hash = await computeSha256(canonicalString);

  return {
    ...params,
    effectiveTimestamp: effective,
    previousHash,
    hash,
  };
}

/**
 * Verify the entire tamper-evident time punch ledger
 */
export async function verifyPunchLedger(punches: TimePunch[]): Promise<boolean> {
  let expectedPrevHash = 'GENESIS';
  for (const punch of punches) {
    if (punch.previousHash !== expectedPrevHash) {
      throw new Error(ERROR_CODES.ERR_LEDGER_HASH_MISMATCH);
    }
    const effective = punch.effectiveTimestamp || punch.timestamp;
    const canonicalString = `${punch.id}|${punch.employeeId}|${punch.type}|${punch.timestamp}|${effective}|${Boolean(punch.isRetroactive)}|${punch.previousHash}`;
    const recomputed = await computeSha256(canonicalString);
    if (recomputed !== punch.hash) {
      throw new Error(ERROR_CODES.ERR_LEDGER_HASH_MISMATCH);
    }
    expectedPrevHash = punch.hash;
  }
  return true;
}

/**
 * Execute Complete Company Factory Reset while preserving templates
 */
export function performCompanyFactoryReset(currentState: AppState): AppState {
  return {
    ...currentState,
    employees: [],
    shifts: [],
    timeOffRequests: [],
    punches: [],
    availability: [],
    messages: [],
    // Preserves at least 1 default department & role template
    departments:
      currentState.departments.length > 0
        ? [currentState.departments[0]]
        : [{ id: 'dept-default', name: 'General Operations', color: '#059669' }],
    roles:
      currentState.roles.length > 0
        ? [currentState.roles[0]]
        : [
            {
              id: 'role-default',
              name: 'Team Member',
              departmentId: 'dept-default',
              hourlyRateDefault: 18,
            },
          ],
  };
}