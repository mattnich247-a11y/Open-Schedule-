/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AvailabilityBlock,
  CoverageRequirement,
  Employee,
  OrganizationSettings,
  ScheduleConflict,
  Shift,
  TimeOffRequest,
} from './types';

/**
 * Format 24-hour time string ("08:00" or "16:30") to 12-hour AM/PM format ("8:00 AM", "4:30 PM")
 */
export function formatTime12H(time24: string): string {
  if (!time24) return '';
  const [hourStr, minuteStr] = time24.split(':');
  let hour = parseInt(hourStr, 10);
  const minutes = minuteStr || '00';
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minutes} ${ampm}`;
}

/**
 * Format a shift time range in 12-hour format, e.g. "8:00 AM – 4:00 PM"
 */
export function formatShiftRange12H(startTime: string, endTime: string): string {
  return `${formatTime12H(startTime)} – ${formatTime12H(endTime)}`;
}

/**
 * Convert time "HH:MM" to decimal minutes from midnight
 */
export function timeToMinutes(time: string): number {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * Calculate duration in hours between two times (handles overnight shifts)
 */
export function calculateShiftHours(startTime: string, endTime: string): number {
  let startMin = timeToMinutes(startTime);
  let endMin = timeToMinutes(endTime);
  if (endMin <= startMin) {
    // Overnight shift (e.g., 20:00 to 02:00)
    endMin += 24 * 60;
  }
  return Math.round(((endMin - startMin) / 60) * 100) / 100;
}

/**
 * Check if two time ranges overlap
 */
export function timesOverlap(
  start1: string,
  end1: string,
  start2: string,
  end2: string
): boolean {
  const s1 = timeToMinutes(start1);
  let e1 = timeToMinutes(end1);
  if (e1 <= s1) e1 += 24 * 60;

  const s2 = timeToMinutes(start2);
  let e2 = timeToMinutes(end2);
  if (e2 <= s2) e2 += 24 * 60;

  return Math.max(s1, s2) < Math.min(e1, e2);
}

/**
 * Get Day of Week number (0 = Sunday, 6 = Saturday) from date string "YYYY-MM-DD"
 */
export function getDayOfWeek(dateStr: string): number {
  // Parse in local time or split safely
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.getDay();
}

/**
 * Get date range (Sunday to Saturday) for a given week start date
 */
export function getWeekDays(weekStartDateIso: string): { date: string; dayOfWeek: number; dayName: string }[] {
  const [year, month, day] = weekStartDateIso.split('-').map(Number);
  const baseDate = new Date(year, month - 1, day);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const result: { date: string; dayOfWeek: number; dayName: string }[] = [];

  for (let i = 0; i < 7; i++) {
    const cur = new Date(baseDate);
    cur.setDate(baseDate.getDate() + i);
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    result.push({
      date: dateStr,
      dayOfWeek: cur.getDay(),
      dayName: dayNames[cur.getDay()],
    });
  }
  return result;
}

/**
 * Detect all scheduling conflicts
 */
export function detectScheduleConflicts(
  shifts: Shift[],
  employees: Employee[],
  settings: OrganizationSettings,
  timeOffRequests: TimeOffRequest[] = [],
  availabilities: AvailabilityBlock[] = []
): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  const empMap = new Map(employees.map((e) => [e.id, e]));

  // Operational buffer checks
  const opOpenMin = timeToMinutes(settings.operationalHours.open) - settings.operationalHours.bufferBeforeHours * 60;
  const opCloseMin = timeToMinutes(settings.operationalHours.close) + settings.operationalHours.bufferAfterHours * 60;

  // Track weekly hours per employee
  const weeklyHoursMap = new Map<string, number>();

  for (const shift of shifts) {
    const shiftHours = calculateShiftHours(shift.startTime, shift.endTime);

    // Buffer check
    const shiftStartMin = timeToMinutes(shift.startTime);
    let shiftEndMin = timeToMinutes(shift.endTime);
    if (shiftEndMin <= shiftStartMin) shiftEndMin += 24 * 60;

    if (shiftStartMin < opOpenMin || shiftEndMin > opCloseMin) {
      conflicts.push({
        id: `buf_${shift.id}`,
        type: 'buffer_breach',
        shiftId: shift.id,
        employeeId: shift.employeeId,
        severity: 'warning',
        message: `Shift ${formatShiftRange12H(shift.startTime, shift.endTime)} breaches operational buffers (${settings.operationalHours.open} - ${settings.operationalHours.close} ± ${settings.operationalHours.bufferBeforeHours}h).`,
      });
    }

    if (!shift.employeeId) continue;
    const employee = empMap.get(shift.employeeId);
    if (!employee) continue;

    // Accumulate hours
    const currentHrs = (weeklyHoursMap.get(employee.id) || 0) + shiftHours;
    weeklyHoursMap.set(employee.id, currentHrs);

    // Role qualification check
    const hasRole = employee.roleIds.includes(shift.roleId);
    if (!hasRole) {
      conflicts.push({
        id: `role_${shift.id}`,
        type: 'missing_qualifications',
        shiftId: shift.id,
        employeeId: employee.id,
        severity: 'error',
        message: `${employee.name} is not certified/qualified for this assigned role.`,
      });
    }

    // Required tags check
    if (shift.requiredTags && shift.requiredTags.length > 0) {
      const missingTags = shift.requiredTags.filter((t) => !employee.tags.includes(t));
      if (missingTags.length > 0) {
        conflicts.push({
          id: `tags_${shift.id}`,
          type: 'missing_qualifications',
          shiftId: shift.id,
          employeeId: employee.id,
          severity: 'error',
          message: `${employee.name} lacks required tags: ${missingTags.join(', ')}.`,
        });
      }
    }

    // Approved time-off check (handles full-day, morning half-day, and night half-day)
    const matchedTimeOff = timeOffRequests.find(
      (req) =>
        req.employeeId === employee.id &&
        req.status === 'approved' &&
        shift.date >= req.startDate &&
        shift.date <= req.endDate &&
        (
          !req.partOfDay ||
          req.partOfDay === 'full_day' ||
          (req.partOfDay === 'morning_half' && shift.startTime < '13:00') ||
          (req.partOfDay === 'night_half' && shift.endTime > '13:00')
        )
    );
    if (matchedTimeOff) {
      const typeLabel = matchedTimeOff.requestType ? matchedTimeOff.requestType.toUpperCase() : 'time-off';
      const partLabel =
        matchedTimeOff.partOfDay === 'morning_half'
          ? ' (Morning Off)'
          : matchedTimeOff.partOfDay === 'night_half'
          ? ' (Night Off)'
          : '';
      conflicts.push({
        id: `timeoff_${shift.id}`,
        type: 'time_off_clash',
        shiftId: shift.id,
        employeeId: employee.id,
        severity: 'error',
        message: `${employee.name} has approved ${typeLabel}${partLabel} on ${shift.date}.`,
      });
    }

    // Availability block check
    const dayOfWeek = getDayOfWeek(shift.date);
    const unavailBlock = availabilities.find(
      (b) =>
        b.employeeId === employee.id &&
        b.dayOfWeek === dayOfWeek &&
        b.preference === 'unavailable' &&
        timesOverlap(shift.startTime, shift.endTime, b.startTime, b.endTime)
    );
    if (unavailBlock) {
      conflicts.push({
        id: `avail_${shift.id}`,
        type: 'availability_clash',
        shiftId: shift.id,
        employeeId: employee.id,
        severity: 'warning',
        message: `${employee.name} is marked recurringly unavailable during ${formatShiftRange12H(shift.startTime, shift.endTime)}.`,
      });
    }
  }

  // Check double-booking and overtime
  for (let i = 0; i < shifts.length; i++) {
    for (let j = i + 1; j < shifts.length; j++) {
      const s1 = shifts[i];
      const s2 = shifts[j];
      if (
        s1.employeeId &&
        s1.employeeId === s2.employeeId &&
        s1.date === s2.date &&
        timesOverlap(s1.startTime, s1.endTime, s2.startTime, s2.endTime)
      ) {
        const emp = empMap.get(s1.employeeId);
        conflicts.push({
          id: `double_${s1.id}_${s2.id}`,
          type: 'double_booked',
          shiftId: s2.id,
          employeeId: s1.employeeId,
          severity: 'error',
          message: `${emp?.name || 'Employee'} is double-booked on ${s1.date} with overlapping shifts!`,
        });
      }
    }
  }

  // Overtime checks
  weeklyHoursMap.forEach((hrs, empId) => {
    const emp = empMap.get(empId);
    if (!emp) return;
    const limit = Math.min(emp.maxWeeklyHours, settings.weeklyOvertimeHours);
    if (hrs > limit) {
      conflicts.push({
        id: `ot_${empId}`,
        type: 'overtime_breach',
        shiftId: '',
        employeeId: empId,
        severity: 'warning',
        message: `${emp.name} is scheduled for ${hrs.toFixed(1)} hrs (over threshold of ${limit} hrs/wk).`,
      });
    }
  });

  return conflicts;
}

/**
 * Deterministic (non-AI) constraint-solver auto-allocator
 */
export function autoAllocateOpenShifts(
  openShifts: Shift[],
  allShifts: Shift[],
  employees: Employee[],
  settings: OrganizationSettings,
  timeOffRequests: TimeOffRequest[] = [],
  availabilities: AvailabilityBlock[] = []
): {
  assignedShifts: Shift[];
  unassignedShifts: Shift[];
  assignedCount: number;
} {
  const empMap = new Map(employees.map((e) => [e.id, e]));

  // Calculate existing scheduled hours per employee
  const currentHoursMap = new Map<string, number>();
  for (const emp of employees) {
    currentHoursMap.set(emp.id, 0);
  }
  for (const s of allShifts) {
    if (s.employeeId) {
      const cur = currentHoursMap.get(s.employeeId) || 0;
      currentHoursMap.set(s.employeeId, cur + calculateShiftHours(s.startTime, s.endTime));
    }
  }

  const assignedShifts: Shift[] = [];
  const unassignedShifts: Shift[] = [];
  let assignedCount = 0;

  // Clone open shifts for allocation
  for (const rawShift of openShifts) {
    if (rawShift.employeeId) {
      assignedShifts.push(rawShift);
      continue;
    }

    const shiftHours = calculateShiftHours(rawShift.startTime, rawShift.endTime);
    const dayOfWeek = getDayOfWeek(rawShift.date);

    // Filter candidate employees by hard constraints
    const candidates = employees.filter((emp) => {
      // 1. Role qualification
      if (!emp.roleIds.includes(rawShift.roleId)) return false;

      // 2. Required tags (cross-training skills)
      if (rawShift.requiredTags && rawShift.requiredTags.length > 0) {
        const hasAllTags = rawShift.requiredTags.every((t) => emp.tags.includes(t));
        if (!hasAllTags) return false;
      }

      // 3. Time off clash
      const hasTimeOff = timeOffRequests.some(
        (r) =>
          r.employeeId === emp.id &&
          r.status === 'approved' &&
          rawShift.date >= r.startDate &&
          rawShift.date <= r.endDate
      );
      if (hasTimeOff) return false;

      // 4. Double booking with existing scheduled shifts
      const hasOverlap = allShifts.some(
        (s) =>
          s.employeeId === emp.id &&
          s.date === rawShift.date &&
          timesOverlap(s.startTime, s.endTime, rawShift.startTime, rawShift.endTime)
      );
      if (hasOverlap) return false;

      // 5. Hard availability block ("unavailable")
      const isUnavailable = availabilities.some(
        (b) =>
          b.employeeId === emp.id &&
          b.dayOfWeek === dayOfWeek &&
          b.preference === 'unavailable' &&
          timesOverlap(rawShift.startTime, rawShift.endTime, b.startTime, b.endTime)
      );
      if (isUnavailable) return false;

      // 6. Overtime cap
      const currentHrs = currentHoursMap.get(emp.id) || 0;
      const maxAllowed = Math.min(emp.maxWeeklyHours, settings.weeklyOvertimeHours);
      if (currentHrs + shiftHours > maxAllowed) return false;

      return true;
    });

    if (candidates.length === 0) {
      // Unfillable deterministically
      unassignedShifts.push(rawShift);
      continue;
    }

    // Soft constraint scoring:
    // Score based on:
    // - Preferred availability (+100)
    // - Distance to target hours (prioritize employee with fewest scheduled hours)
    candidates.sort((a, b) => {
      const aPref = availabilities.some(
        (bl) =>
          bl.employeeId === a.id &&
          bl.dayOfWeek === dayOfWeek &&
          bl.preference === 'preferred' &&
          timesOverlap(rawShift.startTime, rawShift.endTime, bl.startTime, bl.endTime)
      );
      const bPref = availabilities.some(
        (bl) =>
          bl.employeeId === b.id &&
          bl.dayOfWeek === dayOfWeek &&
          bl.preference === 'preferred' &&
          timesOverlap(rawShift.startTime, rawShift.endTime, bl.startTime, bl.endTime)
      );

      if (aPref && !bPref) return -1;
      if (!aPref && bPref) return 1;

      const aHrs = currentHoursMap.get(a.id) || 0;
      const bHrs = currentHoursMap.get(b.id) || 0;
      return aHrs - bHrs; // lowest hours first
    });

    const chosen = candidates[0];
    const updatedShift: Shift = {
      ...rawShift,
      employeeId: chosen.id,
      status: 'published',
    };

    // Update tracking
    const newHrs = (currentHoursMap.get(chosen.id) || 0) + shiftHours;
    currentHoursMap.set(chosen.id, newHrs);
    allShifts.push(updatedShift);
    assignedShifts.push(updatedShift);
    assignedCount++;
  }

  return { assignedShifts, unassignedShifts, assignedCount };
}
