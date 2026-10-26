/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Department,
  Employee,
  OpenTableReservationRecord,
  OrganizationSettings,
  OrganizationState,
  PluginDefinition,
  Role,
  Shift,
  ShiftTemplate,
  SkillTag,
  TimePunch,
  ToastSalesRecord,
} from './types';
import { GENESIS_PUNCH_HASH } from './cryptoEngine';

// Pre-computed PBKDF2 hash for password "password123" with salt "d007c0ffee1234567890abcdef123456"
export const DEMO_PASSWORD_SALT = 'd007c0ffee1234567890abcdef123456';
export const DEMO_PASSWORD_HASH = '17072049e6d0a7a37172fe27103328e184001be264ee6501fe1f93ee76fc2580';

// Current week base date helper
export function getDemoCurrentWeekStart(): string {
  const now = new Date();
  const day = now.getDay(); // 0 is Sunday
  const diff = now.getDate() - day; // Go to Sunday
  const sunday = new Date(now.setDate(diff));
  const y = sunday.getFullYear();
  const m = String(sunday.getMonth() + 1).padStart(2, '0');
  const d = String(sunday.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getDateOffset(baseIsoDate: string, offsetDays: number): string {
  const [y, m, d] = baseIsoDate.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + offsetDays);
  const ny = date.getFullYear();
  const nm = String(date.getMonth() + 1).padStart(2, '0');
  const nd = String(date.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

// Built-in plugins in friendly, everyday language
export const DEFAULT_PLUGINS: PluginDefinition[] = [
  {
    id: 'plugin-payroll-csv',
    name: 'Universal Payroll Spreadsheet (.CSV)',
    version: '1.2.0',
    description: 'Creates a clean payroll spreadsheet (Regular & Overtime Hours, Pay Rates, and Total Gross Pay) when you approve hours.',
    author: 'Open Schedule Team',
    enabled: true,
    category: 'payroll',
  },
  {
    id: 'plugin-gusto-adp',
    name: 'Gusto & ADP Payroll Exporter',
    version: '2.0.4',
    description: 'Formats approved hours into Gusto and ADP ready files with standard earning categories.',
    author: 'Payroll Connections',
    enabled: true,
    category: 'payroll',
  },
  {
    id: 'plugin-shift-webhook',
    name: 'Schedule Alerts & Staff Notifications',
    version: '1.0.8',
    description: 'Logs notifications and sends schedule alerts to team members when new shifts are published or swapped.',
    author: 'Open Schedule Team',
    enabled: true,
    category: 'notifications',
  },
  {
    id: 'plugin-pos-connector',
    name: 'Sales & Guest Reservation Connector',
    version: '1.4.1',
    description: 'Connects your daily sales and table reservations to compare staffing levels and keep labor on budget.',
    author: 'Business Insights',
    enabled: true,
    category: 'analytics',
  },
];

// Preset 1: Bistro 313 (Hospitality)
export function getBistro313Preset(): OrganizationState {
  const weekStart = getDemoCurrentWeekStart();
  const mon = getDateOffset(weekStart, 1);
  const tue = getDateOffset(weekStart, 2);
  const wed = getDateOffset(weekStart, 3);
  const thu = getDateOffset(weekStart, 4);
  const fri = getDateOffset(weekStart, 5);
  const sat = getDateOffset(weekStart, 6);

  const settings: OrganizationSettings = {
    orgName: 'Bistro 313',
    industry: 'Hospitality / Restaurant',
    operationalHours: {
      open: '07:00',
      close: '23:00',
      bufferBeforeHours: 1, // staff can open at 06:00
      bufferAfterHours: 1, // staff can close until 00:00
    },
    weeklyOvertimeHours: 40,
    dailyOvertimeHours: 8,
    earlyClockInGraceMinutes: 60,
    maxBreakMinutes: 45,
    geofence: {
      name: 'Bistro 313 Main Dining & Kitchen',
      latitude: 42.3551,
      longitude: -71.0656,
      radiusMeters: 75,
    },
    swapRequiresManagerApproval: true,
    staffCanPostUpForGrabs: true,
    vacationRequiresApproval: true,
    groupChatManagerOnly: false,
    weeklyBudgetsByWeek: {},
    trackLaborCost: true,
    laborBudgetWeekly: 5800,
    totpSecretHex: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    totpDigits: 6,
    payPeriodLockedUntilIso: null,
    managerUsername: 'manager',
    managerPasswordHash: DEMO_PASSWORD_HASH,
    managerSaltHex: DEMO_PASSWORD_SALT,
    featureToggles: {
      useAi: true,
      timeclockMode: 'both',
      trackLaborCost: true,
    },
    cloudSync: {
      enabled: true,
      provider: 'local_relay',
      projectUrl: 'https://relay.openschedule.local',
      apiKey: 'pub_test_anon_key_999',
      lastSyncedIso: null,
    },
    autoSaveIntervalMinutes: 5,
  };

  const departments: Department[] = [
    { id: 'dept-foh', name: 'Front of House', color: '#10b981', description: 'Dining room hospitality, host stand, and bar' },
    { id: 'dept-boh', name: 'Back of House', color: '#f59e0b', description: 'Kitchen line, prep stations, and dish room' },
    { id: 'dept-mgmt', name: 'Management', color: '#8b5cf6', description: 'Floor managers and shift supervisors' },
  ];

  const roles: Role[] = [
    { id: 'role-chef', departmentId: 'dept-boh', name: 'Head Chef', color: '#ef4444' },
    { id: 'role-cook', departmentId: 'dept-boh', name: 'Line Cook', color: '#f97316' },
    { id: 'role-dish', departmentId: 'dept-boh', name: 'Dishwasher', color: '#eab308' },
    { id: 'role-server', departmentId: 'dept-foh', name: 'Server', color: '#10b981' },
    { id: 'role-bartender', departmentId: 'dept-foh', name: 'Bartender', color: '#06b6d4' },
    { id: 'role-host', departmentId: 'dept-foh', name: 'Host / Greeter', color: '#3b82f6' },
    { id: 'role-busser', departmentId: 'dept-foh', name: 'Busser / Runner', color: '#6366f1' },
  ];

  const skillTags: SkillTag[] = [
    { id: 'tag-lead', name: 'Shift Lead', category: 'certification', color: '#a855f7' },
    { id: 'tag-opener', name: 'Opener', category: 'shift_type', color: '#14b8a6' },
    { id: 'tag-closer', name: 'Closer', category: 'shift_type', color: '#6366f1' },
    { id: 'tag-bar-cert', name: 'Bar Certified (TIPS)', category: 'certification', color: '#0ea5e9' },
    { id: 'tag-food-safety', name: 'ServSafe Manager', category: 'certification', color: '#22c55e' },
    { id: 'tag-first-cut', name: 'First Cut', category: 'cut_order', color: '#f59e0b' },
    { id: 'tag-second-cut', name: 'Second Cut', category: 'cut_order', color: '#ec4899' },
  ];

  const employees: Employee[] = [
    {
      id: 'emp-gordon',
      name: 'Chef Gordon Rivera',
      username: 'gordon',
      passwordHash: DEMO_PASSWORD_HASH,
      saltHex: DEMO_PASSWORD_SALT,
      departmentIds: ['dept-boh', 'dept-mgmt'],
      roleIds: ['role-chef', 'role-cook'],
      tags: ['tag-lead', 'tag-food-safety', 'tag-closer'],
      targetWeeklyHours: 40,
      maxWeeklyHours: 45,
      baseHourlyRate: 32.0,
      requiresPasswordChange: false,
      pinCode: '1001',
      currentPunchStatus: 'clocked_out',
    },
    {
      id: 'emp-sarah',
      name: 'Sarah Jenkins',
      username: 'sarah',
      passwordHash: DEMO_PASSWORD_HASH,
      saltHex: DEMO_PASSWORD_SALT,
      departmentIds: ['dept-foh'],
      roleIds: ['role-server', 'role-bartender'],
      tags: ['tag-lead', 'tag-bar-cert', 'tag-opener'],
      targetWeeklyHours: 35,
      maxWeeklyHours: 40,
      baseHourlyRate: 22.5,
      requiresPasswordChange: false,
      pinCode: '1002',
      currentPunchStatus: 'clocked_out',
    },
    {
      id: 'emp-marco',
      name: 'Marco Diaz',
      username: 'marco',
      passwordHash: DEMO_PASSWORD_HASH,
      saltHex: DEMO_PASSWORD_SALT,
      departmentIds: ['dept-foh'],
      roleIds: ['role-bartender', 'role-server'],
      tags: ['tag-bar-cert', 'tag-closer'],
      targetWeeklyHours: 32,
      maxWeeklyHours: 40,
      baseHourlyRate: 24.0,
      requiresPasswordChange: false,
      pinCode: '1003',
      currentPunchStatus: 'clocked_out',
    },
    {
      id: 'emp-elena',
      name: 'Elena Rostova',
      username: 'elena',
      passwordHash: DEMO_PASSWORD_HASH,
      saltHex: DEMO_PASSWORD_SALT,
      departmentIds: ['dept-boh'],
      roleIds: ['role-cook', 'role-dish'],
      tags: ['tag-opener', 'tag-food-safety'],
      targetWeeklyHours: 36,
      maxWeeklyHours: 40,
      baseHourlyRate: 21.0,
      requiresPasswordChange: false,
      pinCode: '1004',
      currentPunchStatus: 'clocked_out',
    },
    {
      id: 'emp-lucas',
      name: 'Lucas Vance',
      username: 'lucas',
      passwordHash: DEMO_PASSWORD_HASH,
      saltHex: DEMO_PASSWORD_SALT,
      departmentIds: ['dept-foh'],
      roleIds: ['role-busser', 'role-host'],
      tags: ['tag-first-cut', 'tag-closer'],
      targetWeeklyHours: 25,
      maxWeeklyHours: 30,
      baseHourlyRate: 16.5,
      requiresPasswordChange: false,
      pinCode: '1005',
      currentPunchStatus: 'clocked_out',
    },
    {
      id: 'emp-maya',
      name: 'Maya Lin',
      username: 'maya',
      passwordHash: DEMO_PASSWORD_HASH,
      saltHex: DEMO_PASSWORD_SALT,
      departmentIds: ['dept-foh'],
      roleIds: ['role-server', 'role-host'],
      tags: ['tag-second-cut'],
      targetWeeklyHours: 28,
      maxWeeklyHours: 35,
      baseHourlyRate: 20.0,
      requiresPasswordChange: false,
      pinCode: '1006',
      currentPunchStatus: 'clocked_out',
    },
  ];

  const shiftTemplates: ShiftTemplate[] = [
    { id: 'tmpl-open-kitchen', name: 'Kitchen Opener (7:00 AM – 3:30 PM)', roleId: 'role-cook', startTime: '07:00', endTime: '15:30', requiredTags: ['tag-opener'] },
    { id: 'tmpl-close-kitchen', name: 'Kitchen Closer (3:30 PM – 11:30 PM)', roleId: 'role-cook', startTime: '15:30', endTime: '23:30', requiredTags: ['tag-closer'] },
    { id: 'tmpl-open-foh', name: 'FOH Lunch (10:00 AM – 4:00 PM)', roleId: 'role-server', startTime: '10:00', endTime: '16:00', requiredTags: ['tag-opener'] },
    { id: 'tmpl-dinner-rush', name: 'Dinner Service (4:00 PM – 11:00 PM)', roleId: 'role-server', startTime: '16:00', endTime: '23:00', requiredTags: ['tag-closer'] },
    { id: 'tmpl-bar-close', name: 'Bar Close (5:00 PM – 12:00 AM)', roleId: 'role-bartender', startTime: '17:00', endTime: '00:00', requiredTags: ['tag-bar-cert', 'tag-closer'] },
  ];

  const shifts: Shift[] = [
    // Monday
    { id: 's-mon-1', employeeId: 'emp-gordon', roleId: 'role-chef', departmentId: 'dept-boh', date: mon, startTime: '09:00', endTime: '17:00', requiredTags: ['tag-lead'], status: 'published', isUpForGrabs: false },
    { id: 's-mon-2', employeeId: 'emp-sarah', roleId: 'role-server', departmentId: 'dept-foh', date: mon, startTime: '10:00', endTime: '16:00', requiredTags: ['tag-opener'], status: 'published', isUpForGrabs: false },
    { id: 's-mon-3', employeeId: 'emp-elena', roleId: 'role-cook', departmentId: 'dept-boh', date: mon, startTime: '07:00', endTime: '15:30', requiredTags: ['tag-opener'], status: 'published', isUpForGrabs: false },
    { id: 's-mon-4', employeeId: 'emp-marco', roleId: 'role-bartender', departmentId: 'dept-foh', date: mon, startTime: '16:00', endTime: '23:30', requiredTags: ['tag-closer'], status: 'published', isUpForGrabs: false },
    // Tuesday
    { id: 's-tue-1', employeeId: 'emp-gordon', roleId: 'role-chef', departmentId: 'dept-boh', date: tue, startTime: '09:00', endTime: '17:00', requiredTags: ['tag-lead'], status: 'published', isUpForGrabs: false },
    { id: 's-tue-2', employeeId: 'emp-lucas', roleId: 'role-busser', departmentId: 'dept-foh', date: tue, startTime: '11:00', endTime: '16:00', requiredTags: ['tag-first-cut'], status: 'published', isUpForGrabs: false },
    { id: 's-tue-3', employeeId: 'emp-maya', roleId: 'role-server', departmentId: 'dept-foh', date: tue, startTime: '16:00', endTime: '22:00', requiredTags: [], status: 'published', isUpForGrabs: false },
    // Wednesday
    { id: 's-wed-1', employeeId: 'emp-sarah', roleId: 'role-server', departmentId: 'dept-foh', date: wed, startTime: '10:00', endTime: '16:00', requiredTags: [], status: 'published', isUpForGrabs: true, notes: 'Available for trade if anyone wants extra hours' },
    { id: 's-wed-2', employeeId: 'emp-elena', roleId: 'role-cook', departmentId: 'dept-boh', date: wed, startTime: '14:00', endTime: '22:00', requiredTags: ['tag-closer'], status: 'published', isUpForGrabs: false },
    // Thursday
    { id: 's-thu-1', employeeId: 'emp-marco', roleId: 'role-bartender', departmentId: 'dept-foh', date: thu, startTime: '16:00', endTime: '23:30', requiredTags: ['tag-closer'], status: 'published', isUpForGrabs: false },
    { id: 's-thu-2', employeeId: 'emp-gordon', roleId: 'role-chef', departmentId: 'dept-boh', date: thu, startTime: '10:00', endTime: '18:00', requiredTags: ['tag-lead'], status: 'published', isUpForGrabs: false },
    // Friday
    { id: 's-fri-1', employeeId: 'emp-gordon', roleId: 'role-chef', departmentId: 'dept-boh', date: fri, startTime: '14:00', endTime: '23:00', requiredTags: ['tag-lead', 'tag-closer'], status: 'published', isUpForGrabs: false },
    { id: 's-fri-2', employeeId: 'emp-sarah', roleId: 'role-server', departmentId: 'dept-foh', date: fri, startTime: '16:00', endTime: '23:30', requiredTags: ['tag-lead', 'tag-closer'], status: 'published', isUpForGrabs: false },
    { id: 's-fri-3', employeeId: 'emp-marco', roleId: 'role-bartender', departmentId: 'dept-foh', date: fri, startTime: '16:30', endTime: '00:00', requiredTags: ['tag-bar-cert', 'tag-closer'], status: 'published', isUpForGrabs: false },
    { id: 's-fri-4', employeeId: 'emp-lucas', roleId: 'role-busser', departmentId: 'dept-foh', date: fri, startTime: '17:00', endTime: '23:00', requiredTags: ['tag-closer'], status: 'published', isUpForGrabs: false },
    { id: 's-fri-5', employeeId: null, roleId: 'role-cook', departmentId: 'dept-boh', date: fri, startTime: '15:00', endTime: '23:00', requiredTags: ['tag-closer'], status: 'draft', isUpForGrabs: false, notes: 'Dinner rush open shift' },
    // Saturday
    { id: 's-sat-1', employeeId: 'emp-sarah', roleId: 'role-server', departmentId: 'dept-foh', date: sat, startTime: '11:00', endTime: '19:00', requiredTags: [], status: 'published', isUpForGrabs: false },
    { id: 's-sat-2', employeeId: 'emp-elena', roleId: 'role-cook', departmentId: 'dept-boh', date: sat, startTime: '11:00', endTime: '19:00', requiredTags: [], status: 'published', isUpForGrabs: false },
    { id: 's-sat-3', employeeId: null, roleId: 'role-bartender', departmentId: 'dept-foh', date: sat, startTime: '17:00', endTime: '00:00', requiredTags: ['tag-bar-cert'], status: 'draft', isUpForGrabs: false, notes: 'Saturday evening open bartender slot' },
  ];

  const p1Time = `${mon}T08:58:12Z`;
  const p1Hash = '5f4dcc3b5aa765d61d8327deb882cf992b95990a9151374abd8b59319363830c';
  const p2Time = `${mon}T17:02:44Z`;
  const p2Hash = '7d247f0e34c26a9782559b1f83db563fa12270ddcf4d01b13ef454c0e668619e';

  const punches: TimePunch[] = [
    {
      id: 'punch-1',
      employeeId: 'emp-gordon',
      shiftId: 's-mon-1',
      punchType: 'clock_in',
      timestampIso: p1Time,
      prevHash: GENESIS_PUNCH_HASH,
      hash: p1Hash,
      latitude: 42.3551,
      longitude: -71.0656,
      accuracyMeters: 8,
      verifiedVia: 'gps',
      deviceId: 'dev_pos_tablet_1',
    },
    {
      id: 'punch-2',
      employeeId: 'emp-gordon',
      shiftId: 's-mon-1',
      punchType: 'clock_out',
      timestampIso: p2Time,
      prevHash: p1Hash,
      hash: p2Hash,
      latitude: 42.3551,
      longitude: -71.0656,
      accuracyMeters: 10,
      verifiedVia: 'gps',
      deviceId: 'dev_pos_tablet_1',
    },
  ];

  const salesData: ToastSalesRecord[] = [
    { date: fri, hour: 17, grossSales: 1250, orderCount: 38, channel: 'dine_in' },
    { date: fri, hour: 18, grossSales: 2180, orderCount: 64, channel: 'dine_in' },
    { date: fri, hour: 19, grossSales: 3420, orderCount: 92, channel: 'dine_in' },
    { date: fri, hour: 20, grossSales: 2890, orderCount: 78, channel: 'dine_in' },
    { date: fri, hour: 21, grossSales: 1740, orderCount: 45, channel: 'dine_in' },
    { date: sat, hour: 18, grossSales: 2450, orderCount: 70, channel: 'dine_in' },
    { date: sat, hour: 19, grossSales: 3890, orderCount: 105, channel: 'dine_in' },
    { date: sat, hour: 20, grossSales: 3120, orderCount: 88, channel: 'dine_in' },
  ];

  const reservationsData: OpenTableReservationRecord[] = [
    { date: fri, timeSlot: '17:30', coversExpected: 28, partyCount: 8 },
    { date: fri, timeSlot: '18:30', coversExpected: 64, partyCount: 18, notes: '2 anniversary parties' },
    { date: fri, timeSlot: '19:30', coversExpected: 78, partyCount: 22, notes: 'Full dining room capacity' },
    { date: fri, timeSlot: '20:30', coversExpected: 46, partyCount: 14 },
    { date: sat, timeSlot: '18:00', coversExpected: 52, partyCount: 16 },
    { date: sat, timeSlot: '19:30', coversExpected: 88, partyCount: 26, notes: 'Private event room booked (20 covers)' },
  ];

  return {
    settings,
    departments,
    roles,
    skillTags,
    employees,
    shifts,
    shiftTemplates,
    coverageRequirements: [
      { id: 'cov-1', dayOfWeek: 5, roleId: 'role-cook', startTime: '15:00', endTime: '23:00', targetHeadcount: 2 },
      { id: 'cov-2', dayOfWeek: 5, roleId: 'role-server', startTime: '16:00', endTime: '23:30', targetHeadcount: 3 },
      { id: 'cov-3', dayOfWeek: 6, roleId: 'role-bartender', startTime: '17:00', endTime: '00:00', targetHeadcount: 2 },
    ],
    punches,
    timeOffRequests: [
      {
        id: 'to-1',
        employeeId: 'emp-lucas',
        startDate: getDateOffset(weekStart, 4),
        endDate: getDateOffset(weekStart, 4),
        reason: 'College finals exam',
        requestType: 'vacation',
        partOfDay: 'full_day',
        status: 'approved',
        submittedAtIso: `${mon}T10:00:00Z`,
      },
    ],
    availabilities: [
      { id: 'av-1', employeeId: 'emp-lucas', dayOfWeek: 4, startTime: '08:00', endTime: '16:00', preference: 'unavailable' },
      { id: 'av-2', employeeId: 'emp-sarah', dayOfWeek: 5, startTime: '16:00', endTime: '23:30', preference: 'preferred' },
    ],
    messages: [
      {
        id: 'msg-1',
        senderEmployeeId: 'emp-sarah',
        senderName: 'Sarah Jenkins',
        recipientEmployeeId: null,
        text: 'Hey team! I posted my Wednesday lunch shift up for grabs if anyone wants extra hours.',
        timestampIso: `${mon}T14:20:00Z`,
        channel: 'general',
      },
      {
        id: 'msg-2',
        senderEmployeeId: 'emp-gordon',
        senderName: 'Chef Gordon Rivera',
        recipientEmployeeId: null,
        text: 'Team reminder: New seasonal menu tasting on Thursday at 3 PM before evening service.',
        timestampIso: `${mon}T15:00:00Z`,
        channel: 'announcements',
      },
    ],
    plugins: DEFAULT_PLUGINS,
    pluginLogs: [
      {
        id: 'plog-init',
        timestampIso: `${mon}T06:00:00Z`,
        pluginId: 'plugin-pos-connector',
        level: 'info',
        message: 'Loaded sales trends and table reservations.',
      },
    ],
    salesData,
    reservationsData,
    aiConfig: {
      enabled: true,
      provider: 'gemini',
      modelName: 'gemini-2.5-flash',
    },
  };
}

// Preset 2: Apex Outfitter (Retail)
export function getApexOutfitterPreset(): OrganizationState {
  const weekStart = getDemoCurrentWeekStart();
  const mon = getDateOffset(weekStart, 1);
  const fri = getDateOffset(weekStart, 5);

  const settings: OrganizationSettings = {
    orgName: 'Apex Outfitter',
    industry: 'Outdoor Retail & Sporting Goods',
    operationalHours: {
      open: '09:00',
      close: '21:00',
      bufferBeforeHours: 1,
      bufferAfterHours: 1,
    },
    weeklyOvertimeHours: 40,
    dailyOvertimeHours: 8,
    earlyClockInGraceMinutes: 45,
    maxBreakMinutes: 60,
    geofence: {
      name: 'Apex Outfitter Flagship Store',
      latitude: 47.6062,
      longitude: -122.3321,
      radiusMeters: 100,
    },
    swapRequiresManagerApproval: true,
    staffCanPostUpForGrabs: true,
    vacationRequiresApproval: true,
    groupChatManagerOnly: false,
    weeklyBudgetsByWeek: {},
    trackLaborCost: true,
    laborBudgetWeekly: 4200,
    totpSecretHex: 'b855e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852',
    totpDigits: 6,
    managerUsername: 'manager',
    managerPasswordHash: DEMO_PASSWORD_HASH,
    managerSaltHex: DEMO_PASSWORD_SALT,
    featureToggles: {
      useAi: true,
      timeclockMode: 'both',
      trackLaborCost: true,
    },
    cloudSync: {
      enabled: true,
      provider: 'local_relay',
      projectUrl: 'https://relay.openschedule.local',
      apiKey: 'pub_test_anon_key_999',
    },
    autoSaveIntervalMinutes: 5,
  };

  const departments: Department[] = [
    { id: 'dept-sales', name: 'Sales Floor', color: '#10b981', description: 'Camping, apparel, and footwear sales' },
    { id: 'dept-cash', name: 'Cash Wrap & Returns', color: '#3b82f6', description: 'Checkout counters and customer support' },
    { id: 'dept-logistics', name: 'Stockroom & Freight', color: '#f59e0b', description: 'Inbound shipping, sorting, and merchandising' },
  ];

  const roles: Role[] = [
    { id: 'role-supervisor', departmentId: 'dept-sales', name: 'Shift Supervisor', color: '#8b5cf6' },
    { id: 'role-advisor', departmentId: 'dept-sales', name: 'Gear Specialist', color: '#10b981' },
    { id: 'role-cashier', departmentId: 'dept-cash', name: 'Cashier', color: '#3b82f6' },
    { id: 'role-freight', departmentId: 'dept-logistics', name: 'Inventory Receiver', color: '#f59e0b' },
  ];

  const skillTags: SkillTag[] = [
    { id: 'tag-keyholder', name: 'Store Keyholder', category: 'certification', color: '#ef4444' },
    { id: 'tag-forklift', name: 'Forklift Certified', category: 'certification', color: '#f97316' },
    { id: 'tag-bootfitter', name: 'Certified Boot Fitter', category: 'skill', color: '#06b6d4' },
    { id: 'tag-first-aid', name: 'First Aid / CPR', category: 'certification', color: '#22c55e' },
  ];

  const employees: Employee[] = [
    {
      id: 'emp-brett',
      name: 'Brett Callaghan',
      username: 'brett',
      passwordHash: DEMO_PASSWORD_HASH,
      saltHex: DEMO_PASSWORD_SALT,
      departmentIds: ['dept-sales'],
      roleIds: ['role-supervisor', 'role-advisor'],
      tags: ['tag-keyholder', 'tag-first-aid'],
      targetWeeklyHours: 40,
      maxWeeklyHours: 40,
      baseHourlyRate: 26.0,
      requiresPasswordChange: false,
      pinCode: '2001',
      currentPunchStatus: 'clocked_out',
    },
    {
      id: 'emp-chloe',
      name: 'Chloe Zhang',
      username: 'chloe',
      passwordHash: DEMO_PASSWORD_HASH,
      saltHex: DEMO_PASSWORD_SALT,
      departmentIds: ['dept-sales'],
      roleIds: ['role-advisor'],
      tags: ['tag-bootfitter'],
      targetWeeklyHours: 32,
      maxWeeklyHours: 40,
      baseHourlyRate: 20.0,
      requiresPasswordChange: false,
      pinCode: '2002',
      currentPunchStatus: 'clocked_out',
    },
    {
      id: 'emp-darek',
      name: 'Darek Sterling',
      username: 'darek',
      passwordHash: DEMO_PASSWORD_HASH,
      saltHex: DEMO_PASSWORD_SALT,
      departmentIds: ['dept-logistics'],
      roleIds: ['role-freight'],
      tags: ['tag-forklift'],
      targetWeeklyHours: 35,
      maxWeeklyHours: 40,
      baseHourlyRate: 21.5,
      requiresPasswordChange: false,
      pinCode: '2003',
      currentPunchStatus: 'clocked_out',
    },
  ];

  return {
    settings,
    departments,
    roles,
    skillTags,
    employees,
    shifts: [
      { id: 's-apex-1', employeeId: 'emp-brett', roleId: 'role-supervisor', departmentId: 'dept-sales', date: mon, startTime: '08:00', endTime: '16:30', requiredTags: ['tag-keyholder'], status: 'published', isUpForGrabs: false },
      { id: 's-apex-2', employeeId: 'emp-chloe', roleId: 'role-advisor', departmentId: 'dept-sales', date: mon, startTime: '10:00', endTime: '18:00', requiredTags: [], status: 'published', isUpForGrabs: false },
      { id: 's-apex-3', employeeId: 'emp-darek', roleId: 'role-freight', departmentId: 'dept-logistics', date: mon, startTime: '08:00', endTime: '16:00', requiredTags: ['tag-forklift'], status: 'published', isUpForGrabs: false },
      { id: 's-apex-4', employeeId: null, roleId: 'role-cashier', departmentId: 'dept-cash', date: fri, startTime: '12:00', endTime: '20:00', requiredTags: [], status: 'draft', isUpForGrabs: false },
    ],
    shiftTemplates: [
      { id: 'tmpl-store-open', name: 'Store Opener (8:00 AM – 4:30 PM)', roleId: 'role-supervisor', startTime: '08:00', endTime: '16:30', requiredTags: ['tag-keyholder'] },
      { id: 'tmpl-mid-sales', name: 'Mid Floor (11:00 AM – 7:30 PM)', roleId: 'role-advisor', startTime: '11:00', endTime: '19:30', requiredTags: [] },
      { id: 'tmpl-store-close', name: 'Store Closer (1:30 PM – 10:00 PM)', roleId: 'role-advisor', startTime: '13:30', endTime: '22:00', requiredTags: ['tag-keyholder'] },
    ],
    coverageRequirements: [],
    punches: [],
    timeOffRequests: [],
    availabilities: [],
    messages: [],
    plugins: DEFAULT_PLUGINS,
    pluginLogs: [],
    salesData: [],
    reservationsData: [],
    aiConfig: { enabled: true, provider: 'gemini', modelName: 'gemini-2.5-flash' },
  };
}

// Preset 3: Metro Urgent Care (Medical)
export function getMetroUrgentCarePreset(): OrganizationState {
  const weekStart = getDemoCurrentWeekStart();
  const mon = getDateOffset(weekStart, 1);

  const settings: OrganizationSettings = {
    orgName: 'Metro Urgent Care',
    industry: 'Healthcare / Urgent Care Clinic',
    operationalHours: {
      open: '08:00',
      close: '20:00',
      bufferBeforeHours: 1,
      bufferAfterHours: 1,
    },
    weeklyOvertimeHours: 40,
    dailyOvertimeHours: 12,
    earlyClockInGraceMinutes: 30,
    maxBreakMinutes: 30,
    geofence: {
      name: 'Metro Urgent Care Center',
      latitude: 40.7128,
      longitude: -74.006,
      radiusMeters: 60,
    },
    swapRequiresManagerApproval: true,
    staffCanPostUpForGrabs: false,
    vacationRequiresApproval: true,
    groupChatManagerOnly: false,
    weeklyBudgetsByWeek: {},
    trackLaborCost: true,
    laborBudgetWeekly: 9500,
    totpSecretHex: '996fb92427ae41e4649b934ca495991b7852b855e3b0c44298fc1c149afbf4c8',
    totpDigits: 6,
    managerUsername: 'manager',
    managerPasswordHash: DEMO_PASSWORD_HASH,
    managerSaltHex: DEMO_PASSWORD_SALT,
    featureToggles: {
      useAi: true,
      timeclockMode: 'both',
      trackLaborCost: true,
    },
    cloudSync: {
      enabled: true,
      provider: 'local_relay',
      projectUrl: 'https://relay.openschedule.local',
      apiKey: 'pub_test_anon_key_999',
    },
    autoSaveIntervalMinutes: 5,
  };

  const departments: Department[] = [
    { id: 'dept-triage', name: 'Intake & Triage', color: '#06b6d4' },
    { id: 'dept-nursing', name: 'Nursing & Treatment', color: '#10b981' },
    { id: 'dept-lab', name: 'Diagnostics & Lab', color: '#8b5cf6' },
  ];

  const roles: Role[] = [
    { id: 'role-md', departmentId: 'dept-nursing', name: 'Attending Physician', color: '#ef4444' },
    { id: 'role-rn', departmentId: 'dept-nursing', name: 'Registered Nurse (RN)', color: '#10b981' },
    { id: 'role-ma', departmentId: 'dept-triage', name: 'Medical Assistant', color: '#3b82f6' },
    { id: 'role-labtech', departmentId: 'dept-lab', name: 'Phlebotomist / Lab Tech', color: '#8b5cf6' },
  ];

  const skillTags: SkillTag[] = [
    { id: 'tag-acls', name: 'ACLS Certified', category: 'certification', color: '#ef4444' },
    { id: 'tag-triage-lead', name: 'Triage Lead', category: 'certification', color: '#0ea5e9' },
    { id: 'tag-bilingual', name: 'Bilingual (Spanish)', category: 'skill', color: '#10b981' },
    { id: 'tag-iv-cert', name: 'Pediatric IV Certified', category: 'certification', color: '#f59e0b' },
  ];

  const employees: Employee[] = [
    {
      id: 'emp-dr-chen',
      name: 'Dr. Amy Chen, MD',
      username: 'amychen',
      passwordHash: DEMO_PASSWORD_HASH,
      saltHex: DEMO_PASSWORD_SALT,
      departmentIds: ['dept-nursing'],
      roleIds: ['role-md'],
      tags: ['tag-acls'],
      targetWeeklyHours: 40,
      maxWeeklyHours: 48,
      baseHourlyRate: 110.0,
      requiresPasswordChange: false,
      pinCode: '3001',
      currentPunchStatus: 'clocked_out',
    },
    {
      id: 'emp-rn-jamal',
      name: 'Jamal Crawford, RN',
      username: 'jamal',
      passwordHash: DEMO_PASSWORD_HASH,
      saltHex: DEMO_PASSWORD_SALT,
      departmentIds: ['dept-nursing'],
      roleIds: ['role-rn'],
      tags: ['tag-acls', 'tag-iv-cert', 'tag-triage-lead'],
      targetWeeklyHours: 36,
      maxWeeklyHours: 40,
      baseHourlyRate: 45.0,
      requiresPasswordChange: false,
      pinCode: '3002',
      currentPunchStatus: 'clocked_out',
    },
    {
      id: 'emp-ma-sofia',
      name: 'Sofia Reyes, MA',
      username: 'sofia',
      passwordHash: DEMO_PASSWORD_HASH,
      saltHex: DEMO_PASSWORD_SALT,
      departmentIds: ['dept-triage'],
      roleIds: ['role-ma', 'role-labtech'],
      tags: ['tag-bilingual'],
      targetWeeklyHours: 40,
      maxWeeklyHours: 40,
      baseHourlyRate: 24.0,
      requiresPasswordChange: false,
      pinCode: '3003',
      currentPunchStatus: 'clocked_out',
    },
  ];

  return {
    settings,
    departments,
    roles,
    skillTags,
    employees,
    shifts: [
      { id: 's-med-1', employeeId: 'emp-dr-chen', roleId: 'role-md', departmentId: 'dept-nursing', date: mon, startTime: '08:00', endTime: '16:30', requiredTags: ['tag-acls'], status: 'published', isUpForGrabs: false },
      { id: 's-med-2', employeeId: 'emp-rn-jamal', roleId: 'role-rn', departmentId: 'dept-nursing', date: mon, startTime: '07:30', endTime: '16:00', requiredTags: ['tag-acls'], status: 'published', isUpForGrabs: false },
      { id: 's-med-3', employeeId: 'emp-ma-sofia', roleId: 'role-ma', departmentId: 'dept-triage', date: mon, startTime: '08:00', endTime: '16:30', requiredTags: ['tag-bilingual'], status: 'published', isUpForGrabs: false },
    ],
    shiftTemplates: [
      { id: 'tmpl-med-day', name: 'Clinical Day (7:30 AM – 4:00 PM)', roleId: 'role-rn', startTime: '07:30', endTime: '16:00', requiredTags: ['tag-acls'] },
      { id: 'tmpl-med-eve', name: 'Clinical Evening (12:00 PM – 8:30 PM)', roleId: 'role-rn', startTime: '12:00', endTime: '20:30', requiredTags: [] },
    ],
    coverageRequirements: [],
    punches: [],
    timeOffRequests: [],
    availabilities: [],
    messages: [],
    plugins: DEFAULT_PLUGINS,
    pluginLogs: [],
    salesData: [],
    reservationsData: [],
    aiConfig: { enabled: true, provider: 'gemini', modelName: 'gemini-2.5-flash' },
  };
}

// Preset 4: Blank Custom Organization
export function getBlankPreset(): OrganizationState {
  return {
    settings: {
      orgName: 'My Business',
      industry: 'Small Business',
      operationalHours: {
        open: '08:00',
        close: '18:00',
        bufferBeforeHours: 1,
        bufferAfterHours: 1,
      },
      weeklyOvertimeHours: 40,
      dailyOvertimeHours: 8,
      earlyClockInGraceMinutes: 30,
      maxBreakMinutes: 60,
      geofence: {
        name: 'Main Location',
        latitude: 37.7749,
        longitude: -122.4194,
        radiusMeters: 75,
      },
      swapRequiresManagerApproval: true,
      staffCanPostUpForGrabs: true,
      vacationRequiresApproval: true,
      groupChatManagerOnly: false,
      weeklyBudgetsByWeek: {},
      trackLaborCost: true,
      laborBudgetWeekly: 3000,
      totpSecretHex: '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
      totpDigits: 6,
      managerUsername: 'manager',
      managerPasswordHash: DEMO_PASSWORD_HASH,
      managerSaltHex: DEMO_PASSWORD_SALT,
      featureToggles: {
        useAi: false,
        timeclockMode: 'both',
        trackLaborCost: true,
      },
      cloudSync: {
        enabled: true,
        provider: 'local_relay',
        projectUrl: 'https://relay.openschedule.local',
        apiKey: 'pub_test_anon_key_999',
      },
      autoSaveIntervalMinutes: 5,
    },
    departments: [
      { id: 'dept-general', name: 'Team Operations', color: '#10b981' },
    ],
    roles: [
      { id: 'role-lead', departmentId: 'dept-general', name: 'Shift Lead', color: '#3b82f6' },
      { id: 'role-member', departmentId: 'dept-general', name: 'Team Member', color: '#10b981' },
    ],
    skillTags: [
      { id: 'tag-lead', name: 'Lead Qualified', category: 'certification', color: '#8b5cf6' },
    ],
    employees: [],
    shifts: [],
    shiftTemplates: [],
    coverageRequirements: [],
    punches: [],
    timeOffRequests: [],
    availabilities: [],
    messages: [],
    plugins: DEFAULT_PLUGINS,
    pluginLogs: [],
    salesData: [],
    reservationsData: [],
    aiConfig: { enabled: false, provider: 'gemini', modelName: 'gemini-2.5-flash' },
  };
}

export const PRESET_OPTIONS = [
  { id: 'bistro', label: 'Bistro 313 (Hospitality)', loader: getBistro313Preset },
  { id: 'apex', label: 'Apex Outfitter (Retail)', loader: getApexOutfitterPreset },
  { id: 'medical', label: 'Metro Urgent Care (Medical)', loader: getMetroUrgentCarePreset },
  { id: 'blank', label: 'Blank Custom Organization', loader: getBlankPreset },
];
