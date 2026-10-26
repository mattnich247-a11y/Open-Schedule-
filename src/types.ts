/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type AppMode = 'manager' | 'staff' | 'kiosk';

export type PunchType = 'clock_in' | 'break_start' | 'break_end' | 'clock_out';

export type ShiftStatus = 'draft' | 'published' | 'swap_pending';

export type AvailabilityPreference = 'available' | 'unavailable' | 'preferred';

export type TimeclockMode = 'both' | 'kiosk_only' | 'mobile_only';

export interface FeatureToggles {
  useAi: boolean;
  timeclockMode: TimeclockMode;
  trackLaborCost: boolean;
}

export interface CloudSyncConfig {
  enabled: boolean;
  provider: 'supabase' | 'firebase' | 'local_relay';
  projectUrl: string;
  apiKey: string;
  lastSyncedIso?: string | null;
}

export interface Department {
  id: string;
  name: string;
  color: string;
  description?: string;
}

export interface Role {
  id: string;
  departmentId: string;
  name: string;
  color: string;
  description?: string;
}

export interface SkillTag {
  id: string;
  name: string;
  category: 'skill' | 'certification' | 'shift_type' | 'cut_order';
  color: string;
}

export interface Employee {
  id: string;
  name: string;
  username: string;
  passwordHash: string; // PBKDF2
  saltHex: string;
  departmentIds: string[];
  roleIds: string[];
  tags: string[]; // skill/role tag IDs
  targetWeeklyHours: number;
  maxWeeklyHours: number;
  baseHourlyRate: number; // For internal budgeting only
  requiresPasswordChange: boolean;
  pinCode: string; // 4-digit PIN for Kiosk
  activeSessionDeviceId?: string | null;
  currentPunchStatus: 'clocked_out' | 'clocked_in' | 'on_break';
  activeShiftId?: string | null;
  activePunchStartIso?: string | null;
  activeBreakStartIso?: string | null;
  accumulatedBreakSeconds?: number;
  kioskCodeVerified?: boolean; // Stored on employee session so it stays verified across tabs until clock-out
}

export interface Shift {
  id: string;
  employeeId: string | null; // null = open / unassigned shift
  roleId: string;
  departmentId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM (24h internal format, e.g., '08:00')
  endTime: string; // HH:MM (e.g., '16:00')
  requiredTags: string[]; // e.g. ['tag-lead', 'tag-closer']
  notes?: string;
  isUpForGrabs: boolean;
  swapRequestedToEmployeeId?: string | null;
  swapRequestedFromEmployeeId?: string | null;
  status: ShiftStatus;
  requiresClaim?: boolean;
  visibleToEmployeeIds?: string[];
}

export interface ShiftTemplate {
  id: string;
  name: string; // e.g. 'Opener (8:00 AM – 4:00 PM)'
  roleId: string;
  startTime: string;
  endTime: string;
  requiredTags: string[];
}

export interface CoverageRequirement {
  id: string;
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  roleId: string;
  startTime: string;
  endTime: string;
  targetHeadcount: number;
}

export interface TimePunch {
  id: string;
  employeeId: string;
  shiftId: string | null;
  punchType: PunchType;
  timestampIso: string;
  prevHash: string;
  hash: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  verifiedVia: 'gps' | 'totp' | 'pin';
  deviceId: string;
  isTampered?: boolean;
}

export interface TimeOffRequest {
  id: string;
  employeeId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  reason: string;
  requestType: 'vacation' | 'pto' | 'personal';
  partOfDay: 'full_day' | 'morning_half' | 'night_half';
  status: 'pending' | 'approved' | 'rejected';
  submittedAtIso: string;
}

export interface AvailabilityBlock {
  id: string;
  employeeId: string;
  dayOfWeek: number; // 0-6
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  preference: AvailabilityPreference;
}

export interface CoworkerMessage {
  id: string;
  senderEmployeeId: string;
  senderName: string;
  senderRole?: 'manager' | 'staff' | 'system';
  recipientEmployeeId?: string | null; // null = Group / All-Team Chat; employee ID = 1-on-1 direct message
  text: string;
  timestampIso: string;
  channel: 'general' | 'shift_swaps' | 'announcements' | 'direct';
}

export interface WorkplaceGeofence {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface OperationalHours {
  open: string; // e.g. '07:00'
  close: string; // e.g. '23:00'
  bufferBeforeHours: number; // e.g. 1 (staff can be scheduled 1h before open)
  bufferAfterHours: number; // e.g. 1 (staff can be scheduled 1h after close)
}

export interface OrganizationSettings {
  orgName: string;
  industry: string;
  operationalHours: OperationalHours;
  weeklyOvertimeHours: number;
  dailyOvertimeHours: number;
  earlyClockInGraceMinutes: number; // e.g. 60
  maxBreakMinutes: number; // e.g. 45
  geofence: WorkplaceGeofence;
  swapRequiresManagerApproval: boolean;
  staffCanPostUpForGrabs: boolean;
  vacationRequiresApproval: boolean;
  groupChatManagerOnly: boolean;
  weeklyBudgetsByWeek?: Record<string, number>;
  trackLaborCost: boolean;
  laborBudgetWeekly: number;
  totpSecretHex: string;
  totpDigits: 4 | 6;
  payPeriodLockedUntilIso?: string | null;
  managerUsername: string;
  managerPasswordHash: string;
  managerSaltHex: string;
  featureToggles: FeatureToggles;
  cloudSync: CloudSyncConfig;
  autoSaveIntervalMinutes: number;
}

export interface CompactShift {
  id: string;
  e: string | null;
  r: string;
  d: string;
  s: string;
  f: string;
  c?: boolean;
}

export interface CompactCloudPayload {
  orgName: string;
  syncedAtIso: string;
  shifts: CompactShift[];
  messages: {
    id: string;
    sender: string;
    text: string;
    ts: string;
    ch: string;
  }[];
  activeEmployeeIds: string[];
}

export interface CloudPayloadStats {
  rawBytes: number;
  compactBytes: number;
  reductionPercent: number;
  shiftCount: number;
  messageCount: number;
}

export interface ScheduleConflict {
  id: string;
  type: 'double_booked' | 'overtime_breach' | 'availability_clash' | 'time_off_clash' | 'buffer_breach' | 'missing_qualifications';
  shiftId: string;
  employeeId: string | null;
  severity: 'warning' | 'error';
  message: string;
}

export interface TimesheetException {
  id: string;
  punchId: string;
  employeeId: string;
  employeeName: string;
  type: 'early_clock_in' | 'late_clock_in' | 'missed_clock_out' | 'geofence_breach' | 'buddy_punch_risk' | 'tampered_ledger_entry';
  severity: 'warning' | 'alert';
  details: string;
  timestampIso: string;
}

export interface PluginLog {
  id: string;
  timestampIso: string;
  pluginId: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  payloadSummary?: string;
}

export interface PluginDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  enabled: boolean;
  lastExecutedIso?: string;
  category: 'payroll' | 'integrations' | 'notifications' | 'analytics';
}

export interface ToastSalesRecord {
  date: string; // YYYY-MM-DD
  hour: number; // 0-23
  grossSales: number;
  orderCount: number;
  channel: 'dine_in' | 'takeout' | 'catering';
}

export interface OpenTableReservationRecord {
  date: string; // YYYY-MM-DD
  timeSlot: string; // HH:MM
  coversExpected: number;
  partyCount: number;
  notes?: string;
}

export interface AIConfig {
  enabled: boolean;
  provider: 'gemini' | 'openai';
  apiKeyEncrypted?: string;
  modelName: string;
}

export interface OrganizationState {
  settings: OrganizationSettings;
  departments: Department[];
  roles: Role[];
  skillTags: SkillTag[];
  employees: Employee[];
  shifts: Shift[];
  shiftTemplates: ShiftTemplate[];
  coverageRequirements: CoverageRequirement[];
  punches: TimePunch[];
  timeOffRequests: TimeOffRequest[];
  availabilities: AvailabilityBlock[];
  messages: CoworkerMessage[];
  plugins: PluginDefinition[];
  pluginLogs: PluginLog[];
  salesData: ToastSalesRecord[];
  reservationsData: OpenTableReservationRecord[];
  aiConfig: AIConfig;
}
