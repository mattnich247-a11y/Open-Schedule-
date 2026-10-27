/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const ERROR_CODES = {
  ERR_AUTH_INVALID_CREDENTIALS: 'ERR_AUTH_INVALID_CREDENTIALS',
  ERR_DUPLICATE_PIN: 'ERR_DUPLICATE_PIN',
  ERR_SHIFT_DOUBLE_BOOKED: 'ERR_SHIFT_DOUBLE_BOOKED',
  ERR_VACATION_CONFLICT: 'ERR_VACATION_CONFLICT',
  ERR_OVERTIME_BREACH: 'ERR_OVERTIME_BREACH',
  ERR_LEDGER_HASH_MISMATCH: 'ERR_LEDGER_HASH_MISMATCH',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export const EMPLOYEE_COLOR_PALETTE = [
  '#059669', // Emerald
  '#2563EB', // Blue
  '#7C3AED', // Violet
  '#DB2777', // Pink
  '#D97706', // Amber
  '#0D9488', // Teal
  '#4F46E5', // Indigo
  '#E11D48', // Rose
  '#0284C7', // Sky
  '#65A30D', // Lime
] as const;

export type PartialDayPeriod = 'full' | 'morning_half' | 'night_half';

export interface Department {
  id: string;
  name: string;
  color: string;
}

export interface Role {
  id: string;
  name: string;
  departmentId: string;
  hourlyRateDefault?: number;
}

export interface Employee {
  id: string;
  name: string;
  username: string;
  pin: string; // 4-digit unique PIN
  roleIds: string[];
  departmentId: string;
  baseHourlyRate: number;
  maxWeeklyHours: number;
  skills: string[];
  colorHex: string; // Persistent unique employee badge color
  isActive?: boolean;
}

export interface Shift {
  id: string;
  employeeId: string | null;
  roleId: string;
  departmentId?: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  status: 'draft' | 'published';
  upForGrabs?: boolean;
  originalOwnerId?: string | null; // Allows original owner to "Claim Back"
  notes?: string;
}

export interface TimeOffRequest {
  id: string;
  employeeId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  period: PartialDayPeriod; // 'full' | 'morning_half' (until 13:00) | 'night_half' (after 13:00)
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface TimePunch {
  id: string;
  employeeId: string;
  shiftId?: string;
  type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
  timestamp: string; // ISO string
  effectiveTimestamp?: string; // Used when retroactive clock-out is submitted
  isRetroactive?: boolean;
  retroactiveReason?: string;
  previousHash: string;
  hash: string;
  gpsDistanceMeters?: number;
}

export interface AvailabilityEntry {
  id: string;
  employeeId: string;
  dayOfWeek: number; // 0-6
  startTime: string;
  endTime: string;
  preference: 'available' | 'unavailable' | 'preferred';
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderColorHex: string;
  channel: string;
  content: string;
  timestamp: string;
}

export interface ScheduleConflict {
  id: string;
  type: 'double_booked' | 'vacation_conflict' | 'overtime_breach' | 'unassigned';
  code: ErrorCode | string;
  shiftId?: string;
  employeeId?: string;
  message: string;
}

export interface CommunityPlugin {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  sourceUrl?: string;
  enabled: boolean;
  installedAt: string;
}

export interface CompanySettings {
  companyName: string;
  creatorName?: string;
  weeklyOvertimeHours: number;
  geofenceRadiusMeters: number;
  requirePinForKiosk: boolean;
  skillTags: string[];
}

export interface AppState {
  settings: CompanySettings;
  departments: Department[];
  roles: Role[];
  employees: Employee[];
  shifts: Shift[];
  timeOffRequests: TimeOffRequest[];
  punches: TimePunch[];
  availability: AvailabilityEntry[];
  messages: ChatMessage[];
  plugins: CommunityPlugin[];
  isDemoMode?: boolean;
}