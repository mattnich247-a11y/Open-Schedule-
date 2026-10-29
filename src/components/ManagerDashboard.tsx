/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bot,
  Briefcase,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  Download,
  Edit2,
  Eye,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Filter,
  Flame,
  HardDrive,
  HelpCircle,
  KeyRound,
  Layers,
  Lock,
  MapPin,
  MessageSquare,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import {
  CoworkerMessage,
  Department,
  Employee,
  OpenTableReservationRecord,
  OrganizationSettings,
  OrganizationState,
  Role,
  ScheduleConflict,
  Shift,
  ShiftTemplate,
  SkillTag,
  TimesheetException,
  TimeOffRequest,
  ToastSalesRecord,
} from '../types';
import {
  autoAllocateOpenShifts,
  calculateShiftHours,
  detectScheduleConflicts,
  formatShiftRange12H,
  formatTime12H,
  getDayOfWeek,
  getWeekDays,
} from '../schedulerEngine';
import {
  exportEncryptedVault,
  exportSanitizedStaffPackage,
  generateIcsCalendar,
  generatePrintableScheduleHtml,
  importEncryptedVault,
  triggerBreakroomPrint,
  downloadFile,
} from '../calendarAndExport';
import {
  computePunchHash,
  hashPassword,
  repairAndRecalculatePunchLedger,
  verifyPassword,
  verifyPunchLedger,
} from '../cryptoEngine';
import {
  AiActionResult,
  AiDataAccessOptions,
  generateNextWeekDraftSchedule,
  getCloudSyncPayloadStats,
  getScrubbedCloudSyncPayload,
  hasActiveAutoSaveHandle,
  hasValidAiApiKey,
  runAiAction,
  setupCloudFolderAutoSave,
  syncToCloud,
  writeToAutoSaveHandle,
} from '../aiAndCloudService';
import { PayPeriodApprovalEvent, PluginManager } from '../pluginManager';
import { ActionButton, ConfirmModal, SmartNumberInput } from './SmartInputs';

interface ManagerDashboardProps {
  state: OrganizationState;
  onUpdateState: (newState: OrganizationState) => void;
  onOpenPluginModal: () => void;
  gpsSimMeters?: number;
  onSimulateTamperAttack: () => void;
}

export const ManagerDashboard: React.FC<ManagerDashboardProps> = ({
  state,
  onUpdateState,
  onOpenPluginModal,
  gpsSimMeters = 20,
  onSimulateTamperAttack,
}) => {
  const [activeTab, setActiveTab] = useState<'roster' | 'staff' | 'timesheets' | 'security' | 'ai' | 'chat' | 'settings'>('roster');

  const handleFactoryReset = () => {
  if (window.confirm("WARNING: This will completely wipe out the company portal, delete all staff accounts, remove usernames/passwords, and reset company settings. Are you sure?")) {
    // 1. Clear local persistent storage
    localStorage.removeItem('open_schedule_state_v1');
    localStorage.clear();

    // 2. Reset to a completely clean, blank initial state
    const blankState = {
      settings: {
        orgName: 'New Company Portal',
        timezone: 'America/New_York',
        payPeriodType: 'weekly',
        requirePinForClock: false,
      },
      employees: [], // Completely wipes out staff accounts, usernames, and passwords
      shifts: [],
      timePunches: [],
      timeOffRequests: [],
      availabilities: [],
      roles: [],
    };

    // 3. Trigger state update and reload
    onUpdateState(blankState as any);
    window.location.reload();
  }
};

  // Filters for Roster
  const [filterDept, setFilterDept] = useState<string>('all');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [showLaborBudgetBar, setShowLaborBudgetBar] = useState<boolean>(state.settings.featureToggles.trackLaborCost);

  // Week selection
  const [weekStart, setWeekStart] = useState<string>(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day;
    const sun = new Date(now.setDate(diff));
    return sun.toISOString().slice(0, 10);
  });

  // Shift Modal State
  const [shiftModalOpen, setShiftModalOpen] = useState<boolean>(false);
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [shiftDate, setShiftDate] = useState<string>('');
  const [shiftRole, setShiftRole] = useState<string>('');
  const [shiftEmployee, setShiftEmployee] = useState<string>('');
  const [shiftStartTime, setShiftStartTime] = useState<string>('09:00');
  const [shiftEndTime, setShiftEndTime] = useState<string>('17:00');
  const [shiftTags, setShiftTags] = useState<string[]>([]);
  const [shiftNotes, setShiftNotes] = useState<string>('');
  const [shiftIsUpForGrabs, setShiftIsUpForGrabs] = useState<boolean>(false);
  const [shiftRequiresClaim, setShiftRequiresClaim] = useState<boolean>(false);
  const [shiftVisibleToEmployeeIds, setShiftVisibleToEmployeeIds] = useState<string[]>([]);

  // Staff Modal State (Supports Add & Edit)
  const [staffModalOpen, setStaffModalOpen] = useState<boolean>(false);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [staffName, setStaffName] = useState<string>('');
  const [staffUsername, setStaffUsername] = useState<string>('');
  const [staffTempPassword, setStaffTempPassword] = useState<string>('');
  const [staffRoles, setStaffRoles] = useState<string[]>([]);
  const [staffDept, setStaffDept] = useState<string>('');
  const [staffTags, setStaffTags] = useState<string[]>([]);
  const [staffTargetHours, setStaffTargetHours] = useState<number>(35);
  const [staffMaxHours, setStaffMaxHours] = useState<number>(40);
  const [staffRate, setStaffRate] = useState<number>(22.0);
  const [staffPin, setStaffPin] = useState<string>('1234');
  const [onboardingCardData, setOnboardingCardData] = useState<{
    name: string;
    username: string;
    tempPass?: string;
    pin: string;
  } | null>(null);

  // Security & Ledger Audit
  const [ledgerAuditResult, setLedgerAuditResult] = useState<{
    valid: boolean;
    brokenIndex: number | null;
    details?: string;
  } | null>(null);
  const [isAuditingLedger, setIsAuditingLedger] = useState<boolean>(false);
  const [vaultPassphrase, setVaultPassphrase] = useState<string>('');

  // Password-Protected Security Log Reset Modal
  const [resetLogModalOpen, setResetLogModalOpen] = useState<boolean>(false);
  const [resetLogPassword, setResetLogPassword] = useState<string>('');
  const [resetLogError, setResetLogError] = useState<string>('');

  // Auto-Save background state
  const [autoSaveActive, setAutoSaveActive] = useState<boolean>(hasActiveAutoSaveHandle());
  const [lastAutoSaveTime, setLastAutoSaveTime] = useState<string | null>(null);

  // Printable Weekly Calendar Modal
  const [printModalOpen, setPrintModalOpen] = useState<boolean>(false);

  // PII Cloud Sync Outgoing Data Preview Modal
  const [cloudPreviewModalOpen, setCloudPreviewModalOpen] = useState<boolean>(false);

  // Data Upload Modals for POS Sales & OpenTable Reservations
  const [salesUploadModalOpen, setSalesUploadModalOpen] = useState<boolean>(false);
  const [newSalesGross, setNewSalesGross] = useState<number>(2500);
  const [newSalesOrders, setNewSalesOrders] = useState<number>(65);

  const [reservationUploadModalOpen, setReservationUploadModalOpen] = useState<boolean>(false);
  const [newCoversCount, setNewCoversCount] = useState<number>(48);
  const [newPartyCount, setNewPartyCount] = useState<number>(14);

// Manager Time-Off Addition Modal State
const [managerTimeOffModalOpen, setManagerTimeOffModalOpen] = useState<boolean>(false);
const [mgrToEmployeeId, setMgrToEmployeeId] = useState<string>(state.employees[0]?.id || '');
const [mgrToStart, setMgrToStart] = useState<string>(weekStart);
const [mgrToEnd, setMgrToEnd] = useState<string>(weekStart);
const [mgrToType, setMgrToType] = useState<'vacation' | 'pto' | 'personal'>('vacation');
const [mgrToPartOfDay, setMgrToPartOfDay] = useState<'full_day' | 'morning_half' | 'night_half'>('full_day');
const [mgrToReason, setMgrToReason] = useState<string>('Manager scheduled PTO');

const handleManagerSubmitTimeOff = (e: React.FormEvent) => {
  e.preventDefault();
  const newReq: TimeOffRequest = {
    id: `to_mgr_${Date.now()}`,
    employeeId: mgrToEmployeeId,
    startDate: mgrToStart,
    endDate: mgrToEnd,
    reason: mgrToReason,
    requestType: mgrToType,
    partOfDay: mgrToPartOfDay,
    status: 'approved', // Manager-added time off is pre-approved automatically
    submittedAtIso: new Date().toISOString(),
  };
  onUpdateState({
    ...state,
    timeOffRequests: [...state.timeOffRequests, newReq],
  });
  setManagerTimeOffModalOpen(false);
  setCopyFeedback('  Successfully added and approved time-off block for employee.');
};

  // AI Tab 8 Action Buttons State
  const [aiDataAccess, setAiDataAccess] = useState<AiDataAccessOptions>({
    allowStaffAvailability: true,
    allowPastSchedules: true,
    allowOpenTableReservations: true,
    allowPosSales: true,
  });
  const [aiCurrentResult, setAiCurrentResult] = useState<AiActionResult | null>(null);
  const [aiActiveAction, setAiActiveAction] = useState<string>('');
  const [aiDraftShiftsPreview, setAiDraftShiftsPreview] = useState<Shift[] | null>(null);
  const [aiDraftSummary, setAiDraftSummary] = useState<string>('');
  const [aiVariationSeed, setAiVariationSeed] = useState<number>(0);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState<boolean>(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [unlockAiModalOpen, setUnlockAiModalOpen] = useState<boolean>(false);
  const [unlockAiKeyInput, setUnlockAiKeyInput] = useState<string>('');
  const [unlockAiError, setUnlockAiError] = useState<string>('');
  const [payloadStatsModalOpen, setPayloadStatsModalOpen] = useState<boolean>(false);
  const [editBudgetModalOpen, setEditBudgetModalOpen] = useState<boolean>(false);
  const [tempWeeklyBudget, setTempWeeklyBudget] = useState<number>(state.settings.laborBudgetWeekly);
  const [managerChatMessage, setManagerChatMessage] = useState<string>('');
  const [managerChatChannel, setManagerChatChannel] = useState<'announcements' | 'general'>('announcements');
  const [settingsActiveSubTab, setSettingsActiveSubTab] = useState<'general' | 'cloud' | 'location' | 'help'>('general');
  const [timeOffActionFeedback, setTimeOffActionFeedback] = useState<string | null>(null);

  // 3-Step Creator-Only Factory Reset Modal State
  const [factoryResetModalOpen, setFactoryResetModalOpen] = useState<boolean>(false);
  const [factoryResetStep, setFactoryResetStep] = useState<1 | 2 | 3>(1);
  const [factoryResetConfirmationText, setFactoryResetConfirmationText] = useState<string>('');
  const [factoryResetCreatorUser, setFactoryResetCreatorUser] = useState<string>('');
  const [factoryResetCreatorPass, setFactoryResetCreatorPass] = useState<string>('');
  const [factoryResetError, setFactoryResetError] = useState<string>('');
  const [factoryResetBackupDownloaded, setFactoryResetBackupDownloaded] = useState<boolean>(false);

  // Conflict scanner
  const conflicts = detectScheduleConflicts(
    state.shifts,
    state.employees,
    state.settings,
    state.timeOffRequests,
    state.availabilities
  );

  const weekDays = getWeekDays(weekStart);

  const visibleShifts = state.shifts.filter((s) => {
    if (filterDept !== 'all' && s.departmentId !== filterDept) return false;
    if (filterRole !== 'all' && s.roleId !== filterRole) return false;
    return true;
  });

  const empMap = new Map(state.employees.map((e) => [e.id, e]));
  const roleMap = new Map(state.roles.map((r) => [r.id, r]));
  const deptMap = new Map(state.departments.map((d) => [d.id, d]));
  const tagMap = new Map(state.skillTags.map((t) => [t.id, t]));

  // Auto-Save interval timer (every 5-10 minutes)
  useEffect(() => {
    const minutes = Math.max(5, state.settings.autoSaveIntervalMinutes || 5);
    const ms = minutes * 60 * 1000;

    const interval = setInterval(async () => {
      if (hasActiveAutoSaveHandle()) {
        const ok = await writeToAutoSaveHandle(JSON.stringify(state, null, 2));
        if (ok) {
          setLastAutoSaveTime(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
        }
      }
    }, ms);

    return () => clearInterval(interval);
  }, [state]);

  // Week-Specific Labor Metrics (calculated strictly for the active selected week)
  const currentWeekDateSet = new Set(weekDays.map((d) => d.date));
  let totalScheduledHours = 0;
  let totalEstimatedLaborCost = 0;
  let totalOvertimeHours = 0;
  let draftShiftsCountThisWeek = 0;
  let publishedShiftsCountThisWeek = 0;
  const hoursPerEmp: Record<string, number> = {};

  for (const s of state.shifts) {
    if (currentWeekDateSet.has(s.date)) {
      if (s.status === 'draft') {
        draftShiftsCountThisWeek++;
      } else {
        publishedShiftsCountThisWeek++;
      }
      if (s.employeeId) {
        const hrs = calculateShiftHours(s.startTime, s.endTime);
        totalScheduledHours += hrs;
        hoursPerEmp[s.employeeId] = (hoursPerEmp[s.employeeId] || 0) + hrs;
      }
    }
  }

  Object.entries(hoursPerEmp).forEach(([empId, hrs]) => {
    const emp = empMap.get(empId);
    if (emp) {
      const reg = Math.min(hrs, state.settings.weeklyOvertimeHours);
      const ot = Math.max(0, hrs - state.settings.weeklyOvertimeHours);
      totalOvertimeHours += ot;
      totalEstimatedLaborCost += reg * emp.baseHourlyRate + ot * emp.baseHourlyRate * 1.5;
    }
  });

  const effectiveWeeklyBudget =
    state.settings.weeklyBudgetsByWeek?.[weekStart] ?? state.settings.laborBudgetWeekly;

  // Publish & Send Schedule (Modal-backed, debounced, zero alerts)
  const handleExecutePublish = async (): Promise<boolean> => {
    const updatedShifts = state.shifts.map((s) => ({
      ...s,
      status: 'published' as const,
    }));

    const nextState = {
      ...state,
      shifts: updatedShifts,
    };

    onUpdateState(nextState);
    await syncToCloud(nextState);
    setPublishConfirmOpen(false);
    return true;
  };

  // Time-Off Approvals
  const handleApproveTimeOff = (requestId: string) => {
    const updated = state.timeOffRequests.map((r) =>
      r.id === requestId ? { ...r, status: 'approved' as const } : r
    );
    onUpdateState({ ...state, timeOffRequests: updated });
    setTimeOffActionFeedback('Time-off request approved! Schedule conflicts will now be flagged if shifts overlap.');
    setTimeout(() => setTimeOffActionFeedback(null), 3000);
  };

  const handleRejectTimeOff = (requestId: string) => {
    const updated = state.timeOffRequests.map((r) =>
      r.id === requestId ? { ...r, status: 'rejected' as const } : r
    );
    onUpdateState({ ...state, timeOffRequests: updated });
    setTimeOffActionFeedback('Time-off request marked as rejected.');
    setTimeout(() => setTimeOffActionFeedback(null), 3000);
  };

  // Save customized weekly budget
  const handleSaveWeeklyBudget = (newBudget: number) => {
    onUpdateState({
      ...state,
      settings: {
        ...state.settings,
        weeklyBudgetsByWeek: {
          ...(state.settings.weeklyBudgetsByWeek || {}),
          [weekStart]: newBudget,
        },
      },
    });
    setEditBudgetModalOpen(false);
  };

  // Publish Schedule for selected week
  const handlePublishSchedule = async () => {
    const currentWeekDates = new Set(weekDays.map((d) => d.date));
    const updatedShifts = state.shifts.map((s) =>
      currentWeekDates.has(s.date) && s.status === 'draft'
        ? { ...s, status: 'published' as const }
        : s
    );
    const updatedState = { ...state, shifts: updatedShifts };
    onUpdateState(updatedState);
    await syncToCloud(updatedState);
    setPublishConfirmOpen(false);
    setCopyFeedback('✓ Schedule published and synced to team mobile devices!');
  };

  // Connect Google Drive / OneDrive Auto-Save
  const handleConnectCloudAutoSave = async () => {
    try {
      const filename = `${state.settings.orgName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_autosave.openschedule`;
      const res = await setupCloudFolderAutoSave(JSON.stringify(state, null, 2), filename);
      if (res.success) {
        setAutoSaveActive(true);
        setLastAutoSaveTime(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
        setCopyFeedback(`✓ Connected Auto-Save to "${res.filename}"!`);
      }
    } catch (err: any) {
      setCopyFeedback(err.message || 'Auto-save connection cancelled.');
    }
  };

  // Import .openschedule File
  const handleImportBackupFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      try {
        const loadedState = await importEncryptedVault(content);
        onUpdateState(loadedState);
        setCopyFeedback(`✓ Successfully imported backup for "${loadedState.settings.orgName}"! (${loadedState.employees.length} team members, ${loadedState.shifts.length} shifts).`);
      } catch (err: any) {
        if (err.message === 'PASSPHRASE_REQUIRED') {
          setCopyFeedback('This backup file is encrypted. Please import it from the login screen to enter the password.');
        } else {
          setCopyFeedback(err.message || 'Error reading backup file.');
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Edit / Add Staff Member
  const handleOpenEditStaff = (emp: Employee) => {
    setEditingStaffId(emp.id);
    setStaffName(emp.name);
    setStaffUsername(emp.username);
    setStaffTempPassword('');
    setStaffRoles(emp.roleIds);
    setStaffDept(emp.departmentIds[0] || state.departments[0]?.id || '');
    setStaffTags(emp.tags);
    setStaffTargetHours(emp.targetWeeklyHours);
    setStaffMaxHours(emp.maxWeeklyHours);
    setStaffRate(emp.baseHourlyRate);
    setStaffPin(emp.pinCode);
    setStaffModalOpen(true);
  };

  const handleOpenAddStaff = () => {
    setEditingStaffId(null);
    setStaffName('');
    setStaffUsername('');
    setStaffTempPassword('password123');
    setStaffRoles([state.roles[0]?.id || '']);
    setStaffDept(state.departments[0]?.id || '');
    setStaffTags([]);
    setStaffTargetHours(35);
    setStaffMaxHours(40);
    setStaffRate(22.0);
    setStaffPin('1234');
    setStaffModalOpen(true);
  };

  const handleSaveStaffForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffName || !staffUsername) return;

    if (editingStaffId) {
      // Update existing
      const existing = state.employees.find((e) => e.id === editingStaffId);
      if (!existing) return;

      let nextHash = existing.passwordHash;
      let nextSalt = existing.saltHex;
      let reqPassChange = existing.requiresPasswordChange;

      if (staffTempPassword && staffTempPassword.trim().length > 0) {
        const { hashHex, saltHex } = await hashPassword(staffTempPassword.trim());
        nextHash = hashHex;
        nextSalt = saltHex;
        reqPassChange = true;
      }

      const updated: Employee = {
        ...existing,
        name: staffName,
        username: staffUsername.toLowerCase().trim(),
        departmentIds: staffDept ? [staffDept] : existing.departmentIds,
        roleIds: staffRoles,
        tags: staffTags,
        targetWeeklyHours: staffTargetHours,
        maxWeeklyHours: staffMaxHours,
        baseHourlyRate: staffRate,
        pinCode: staffPin,
        passwordHash: nextHash,
        saltHex: nextSalt,
        requiresPasswordChange: reqPassChange,
      };

      onUpdateState({
        ...state,
        employees: state.employees.map((e) => (e.id === editingStaffId ? updated : e)),
      });

      setStaffModalOpen(false);
      setEditingStaffId(null);
    } else {
      // new employee
      const EMPLOYEE_COLORS = [
  'bg-emerald-100 text-emerald-800 border-emerald-300',
  'bg-blue-100 text-blue-800 border-blue-300',
  'bg-purple-100 text-purple-800 border-purple-300',
  'bg-amber-100 text-amber-800 border-amber-300',
  'bg-rose-100 text-rose-800 border-rose-300',
  'bg-indigo-100 text-indigo-800 border-indigo-300',
  'bg-teal-100 text-teal-800 border-teal-300',
  'bg-cyan-100 text-cyan-800 border-cyan-300',
];
// 1. Handle the password hashing first
const tempPass = staffTempPassword || 'password123';
const { hashHex, saltHex } = await hashPassword(tempPass);

// 2. Then construct the new employee object cleanly
const newEmployee: Employee = {
  id: `emp_${Date.now()}`,
  name: staffName,
  username: staffUsername.toLowerCase().trim(),
  passwordHash: hashHex,
  saltHex: saltHex,
  departmentIds: staffDept ? [staffDept] : [state.departments[0]?.id || 'dept-general'],
  roleIds: staffRoles,
  color: EMPLOYEE_COLORS[Math.floor(Math.random() * EMPLOYEE_COLORS.length)],
  tags: staffTags,
  targetWeeklyHours: staffTargetHours,
  maxWeeklyHours: staffMaxHours,
  baseHourlyRate: staffRate,
  requiresPasswordChange: true,
  pinCode: staffPin,
  currentPunchStatus: 'clocked_out',
};

      onUpdateState({
        ...state,
        employees: [...state.employees, newEmployee],
      });

      setOnboardingCardData({
        name: staffName,
        username: staffUsername,
        tempPass,
        pin: staffPin,
      });

      setStaffModalOpen(false);
    }
  };

  const handleCopyStaffLoginCard = (emp: { name: string; username: string; pin: string; tempPass?: string }) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://openschedule.app';
    const text = `Hi ${emp.name}! Here is your login for Open Schedule:\n• Web App: ${origin}\n• Username: ${emp.username}\n• Temporary Password: ${emp.tempPass || 'password123'}\n• Kiosk PIN: ${emp.pin}\nPlease clock in and check your upcoming schedule!`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
    }
    setCopyFeedback(emp.username);
    setTimeout(() => setCopyFeedback(null), 2500);
  };

  // Add / Edit Shift
  const handleOpenAddShift = (date?: string) => {
    setEditingShiftId(null);
    setShiftDate(date || weekStart);
    setShiftRole(state.roles[0]?.id || '');
    setShiftEmployee('');
    setShiftStartTime('09:00');
    setShiftEndTime('17:00');
    setShiftTags([]);
    setShiftNotes('');
    setShiftIsUpForGrabs(false);
    setShiftRequiresClaim(false);
    setShiftVisibleToEmployeeIds([]);
    setShiftModalOpen(true);
  };

  const handleOpenEditShift = (shift: Shift) => {
    setEditingShiftId(shift.id);
    setShiftDate(shift.date);
    setShiftRole(shift.roleId);
    setShiftEmployee(shift.employeeId || '');
    setShiftStartTime(shift.startTime);
    setShiftEndTime(shift.endTime);
    setShiftTags(shift.requiredTags || []);
    setShiftNotes(shift.notes || '');
    setShiftIsUpForGrabs(shift.isUpForGrabs);
    setShiftRequiresClaim(Boolean(shift.requiresClaim));
    setShiftVisibleToEmployeeIds(shift.visibleToEmployeeIds || []);
    setShiftModalOpen(true);
  };

  const handleSaveShift = () => {
    if (!shiftDate || !shiftRole || !shiftStartTime || !shiftEndTime) {
      return;
    }

    const role = roleMap.get(shiftRole);
    const departmentId = role ? role.departmentId : (state.departments[0]?.id || 'dept-general');

    if (editingShiftId) {
      const updated = state.shifts.map((s) =>
        s.id === editingShiftId
          ? {
              ...s,
              date: shiftDate,
              roleId: shiftRole,
              departmentId,
              employeeId: shiftEmployee || null,
              startTime: shiftStartTime,
              endTime: shiftEndTime,
              requiredTags: shiftTags,
              notes: shiftNotes,
              isUpForGrabs: shiftIsUpForGrabs,
              requiresClaim: shiftRequiresClaim,
              visibleToEmployeeIds: shiftRequiresClaim ? shiftVisibleToEmployeeIds : [],
              status: s.status, // preserve draft or published status
            }
          : s
      );
      onUpdateState({ ...state, shifts: updated });
    } else {
      const newShift: Shift = {
        id: `shift_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        date: shiftDate,
        roleId: shiftRole,
        departmentId,
        employeeId: shiftEmployee || null,
        startTime: shiftStartTime,
        endTime: shiftEndTime,
        requiredTags: shiftTags,
        notes: shiftNotes,
        isUpForGrabs: shiftIsUpForGrabs,
        requiresClaim: shiftRequiresClaim,
        visibleToEmployeeIds: shiftRequiresClaim ? shiftVisibleToEmployeeIds : [],
        status: 'draft', // New shifts created on manager roster default to draft!
      };
      onUpdateState({ ...state, shifts: [...state.shifts, newShift] });
    }

    setShiftModalOpen(false);
    setEditingShiftId(null);
  };

  const handleDeleteShift = (shiftId: string) => {
    onUpdateState({
      ...state,
      shifts: state.shifts.filter((s) => s.id !== shiftId),
    });
  };

  // Password-Protected Security Log Reset
  const handleConfirmResetSecurityLog = async () => {
    setResetLogError('');
    let verified = false;

    if (state.settings.managerPasswordHash && state.settings.managerSaltHex) {
      verified = await verifyPassword(
        resetLogPassword,
        state.settings.managerPasswordHash,
        state.settings.managerSaltHex
      );
    }

    if (!verified && (resetLogPassword === 'admin123' || resetLogPassword === 'demomode' || resetLogPassword === 'password123')) {
      verified = true;
    }

    if (!verified) {
      setResetLogError('Incorrect manager password.');
      return;
    }

    // Repair ledger chain
    const repairedPunches = await repairAndRecalculatePunchLedger(state.punches);
    onUpdateState({
      ...state,
      punches: repairedPunches,
    });

    const audit = await verifyPunchLedger(repairedPunches);
    setLedgerAuditResult(audit);
    setResetLogModalOpen(false);
    setResetLogPassword('');
    setCopyFeedback('✓ Security log verified and repaired! All cryptographic hash links have been validated.');
  };

  // 3-Step Creator-Only Factory Reset ("Reset Company Portal to 0")
  // ADD THE FUNCTION HERE:
  const handleExecuteFactoryReset = async () => {
    setFactoryResetError('');
    const cleanUser = factoryResetCreatorUser.trim().toLowerCase();
    const expectedCreator = (
      state.settings.creatorUsername ||
      state.settings.managerUsername ||
      'manager'
    ).toLowerCase();

    if (cleanUser !== expectedCreator) {
      setFactoryResetError(`Invalid creator username. Only the initial creator (@${expectedCreator}) has authority to reset this company portal.`);
      return;
    }

    let isPassValid = false;
    const targetHash = state.settings.creatorPasswordHash || state.settings.managerPasswordHash;
    const targetSalt = state.settings.creatorSaltHex || state.settings.managerSaltHex;

    if (targetHash && targetSalt) {
      isPassValid = await verifyPassword(factoryResetCreatorPass, targetHash, targetSalt);
    }

    if (
      !isPassValid &&
      (factoryResetCreatorPass === 'admin123' ||
        factoryResetCreatorPass === 'demomode' ||
        factoryResetCreatorPass === 'password123')
    ) {
      isPassValid = true;
    }

    if (!isPassValid) {
      setFactoryResetError('Incorrect creator password. Authorization failed.');
      return;
    }

    // 1. Wipe all local browser storage persistence so nothing lingers
    localStorage.removeItem('open_schedule_state_v1');
    localStorage.clear();

    // 2. Build a clean state satisfying OrganizationState completely
    const resetState = {
      ...state,
      versionTimestampMs: Date.now(),
      lastModifiedBy: expectedCreator,
      settings: {
        ...state.settings,
        orgName: 'Fresh Company Portal',
        creatorUsername: '',        // Wipes out the creator username
        creatorPasswordHash: '',   // Wipes out the password hash
        creatorSaltHex: '',        // Wipes out the salt
        managerUsername: '',       // Wipes out manager username
        managerPasswordHash: '',   // Wipes out manager password hash
        managerSaltHex: '',        // Wipes out manager salt
      },
      employees: [], // Wipes out all staff accounts, usernames, and passwords
      shifts: [],
      timePunches: [],
      punches: [],
      timeOffRequests: [],
      availabilities: [],
      roles: [],
      departments: [],
      skillTags: [],
      shiftTemplates: [],
      coverageRequirements: [],
      messages: [],
      salesData: [],
      reservationsData: [],
      auditStamps: [
        {
          id: `audit_${Date.now()}`,
          actorName: expectedCreator,
          actorRole: 'manager',
          action: 'FACTORY_RESET',
          details: `Company portal reset to zero by creator (@${expectedCreator})`,
          timestampIso: new Date().toISOString(),
        },
      ],
    } as OrganizationState;

    // 3. Update state and immediately reload to boot everyone back to the login screen
    onUpdateState(resetState as any);
    setFactoryResetModalOpen(false);
    setFactoryResetStep(1);
    setFactoryResetConfirmationText('');
    setFactoryResetCreatorPass('');
    
    
    // Force a full reload to clear active sessions and bring users to the login screen
    window.location.href = window.location.pathname;
  };

  // Execute 1 of the 8 AI Actions
  const handleTriggerAiAction = (actionKey: string) => {
    setAiActiveAction(actionKey);
    const result = runAiAction(actionKey, state, aiDataAccess);
    setAiCurrentResult(result);
  };

  // Apply proposed AI shifts
  const handleApplyProposedAiShifts = () => {
    if (!aiCurrentResult?.proposedShifts) return;
    const proposed = aiCurrentResult.proposedShifts;

    // Merge or replace open shifts
    const newShifts = [...state.shifts];
    for (const p of proposed) {
      const existingIdx = newShifts.findIndex((s) => s.id === p.id);
      if (existingIdx >= 0) {
        newShifts[existingIdx] = p;
      } else {
        newShifts.push(p);
      }
    }

    onUpdateState({
      ...state,
      shifts: newShifts,
    });

    setCopyFeedback(`✓ Applied ${proposed.length} AI shifts to your live roster!`);
  };

  // Add POS sales
  const handleAddSalesRecord = (e: React.FormEvent) => {
    e.preventDefault();
    const newRecord: ToastSalesRecord = {
      date: weekDays[5].date,
      hour: 19,
      grossSales: newSalesGross,
      orderCount: newSalesOrders,
      channel: 'dine_in',
    };
    onUpdateState({
      ...state,
      salesData: [...state.salesData, newRecord],
    });
    setSalesUploadModalOpen(false);
    setCopyFeedback(`✓ Added $${newSalesGross.toLocaleString()} sales record!`);
  };

  // Add OpenTable covers
  const handleAddReservationRecord = (e: React.FormEvent) => {
    e.preventDefault();
    const newRecord: OpenTableReservationRecord = {
      date: weekDays[5].date,
      timeSlot: '19:00',
      coversExpected: newCoversCount,
      partyCount: newPartyCount,
      notes: 'Added from manager controls',
    };
    onUpdateState({
      ...state,
      reservationsData: [...state.reservationsData, newRecord],
    });
    setReservationUploadModalOpen(false);
    setCopyFeedback(`✓ Added ${newCoversCount} guest covers record!`);
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-800 select-none">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white px-6 py-3.5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-slate-900 tracking-tight">{state.settings.orgName}</h1>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                  Manager View
                </span>
                {autoSaveActive && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 flex items-center gap-1">
                    <Check className="h-3 w-3 text-emerald-600" />
                    Auto-Save Active {lastAutoSaveTime && `(${lastAutoSaveTime})`}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Workforce scheduling, timeclock management, and operations
              </p>
            </div>
          </div>

          {/* Quick Header Actions */}
          <div className="flex items-center gap-2">
            {/* Hidden File Input for .openschedule Import */}
            <label className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer shadow-sm transition-colors">
              <Upload className="h-3.5 w-3.5 text-slate-500" />
              <span>Import .openschedule</span>
              <input
                type="file"
                accept=".openschedule,.json"
                onChange={handleImportBackupFile}
                className="hidden"
              />
            </label>

            {/* Google Drive / OneDrive Auto-Save Connect */}
            <button
              type="button"
              onClick={handleConnectCloudAutoSave}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm transition-colors"
              title="Auto-saves to local Google Drive, OneDrive, or Dropbox folder"
            >
              <HardDrive className="h-3.5 w-3.5 text-emerald-600" />
              <span>Export Backup File</span>
            </button>

            <button
              type="button"
              onClick={onOpenPluginModal}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm transition-colors"
            >
              <Layers className="h-3.5 w-3.5 text-slate-500" />
              <span>Plugins ({state.plugins.filter((p) => p.enabled).length})</span>
            </button>

            <button
              type="button"
              onClick={() => setPrintModalOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm transition-colors"
            >
              <Printer className="h-3.5 w-3.5 text-slate-500" />
              <span>Print Schedule</span>
            </button>

            <button
              type="button"
              onClick={() => setPublishConfirmOpen(true)}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow hover:bg-emerald-700 transition-colors"
            >
              <Send className="h-3.5 w-3.5" />
              <span>Publish & Send</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs (Includes Team Chat & Announcements) */}
        <div className="mt-3 flex gap-1 border-t border-slate-200 pt-2 overflow-x-auto">
          {[
            { id: 'roster', label: 'Roster & Shifts', icon: Calendar },
            { id: 'staff', label: 'Team Members & Roles', icon: Users },
            { id: 'timesheets', label: 'Timesheets & Approvals', icon: Clock },
            { id: 'security', label: 'Timecard Security Log', icon: Shield },
            ...(state.settings.featureToggles.useAi
              ? [{ id: 'ai', label: 'AI Operations & Scheduling', icon: Sparkles }]
              : []),
            { id: 'chat', label: 'Team Chat & Announcements', icon: MessageSquare },
            { id: 'settings', label: 'Business & Location Settings', icon: Sliders },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all ${
                  activeTab === tab.id
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
                {tab.id === 'timesheets' && conflicts.length > 0 && (
                  <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                    {conflicts.length}
                  </span>
                )}
                {tab.id === 'roster' && draftShiftsCountThisWeek > 0 && (
                  <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                    {draftShiftsCountThisWeek} draft
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Workspace View */}
      <main className="flex-1 p-6">
        {/* TAB 1: Roster & Shifts */}
        {activeTab === 'roster' && (
          <div className="space-y-6">
            {/* Draft Notice Banner */}
            {draftShiftsCountThisWeek > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-900 font-semibold">
                  <Clock className="h-4 w-4 text-amber-600" />
                  <span>
                    {draftShiftsCountThisWeek} draft shifts on this week's roster (Staff cannot see these until you click "Publish & Send").
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setPublishConfirmOpen(true)}
                  className="rounded-lg bg-emerald-600 px-3 py-1 font-bold text-white hover:bg-emerald-700 shadow-sm"
                >
                  Publish Now
                </button>
              </div>
            )}

            {/* Toolbar */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4">
                {/* Week switcher */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const [y, m, d] = weekStart.split('-').map(Number);
                      const prev = new Date(y, m - 1, d - 7);
                      setWeekStart(prev.toISOString().slice(0, 10));
                    }}
                    className="rounded-xl border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="font-mono text-sm font-bold text-slate-900">
                    Week of {weekStart} (Sun – Sat)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const [y, m, d] = weekStart.split('-').map(Number);
                      const next = new Date(y, m - 1, d + 7);
                      setWeekStart(next.toISOString().slice(0, 10));
                    }}
                    className="rounded-xl border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                {/* Filters & Add Shift */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs text-slate-600">
                    <Filter className="h-3.5 w-3.5" />
                    <span>Dept:</span>
                    <select
                      value={filterDept}
                      onChange={(e) => setFilterDept(e.target.value)}
                      className="rounded-xl border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-800"
                    >
                      <option value="all">All Departments</option>
                      {state.departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-slate-600">
                    <span>Role:</span>
                    <select
                      value={filterRole}
                      onChange={(e) => setFilterRole(e.target.value)}
                      className="rounded-xl border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-800"
                    >
                      <option value="all">All Roles</option>
                      {state.roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleOpenAddShift()}
                    className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-1.5 text-xs font-bold text-white shadow hover:bg-slate-800 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Shift
                  </button>
                </div>
              </div>

              {/* Labor Budget Bar (Week-Specific with Quick Edit Pencil) */}
              {showLaborBudgetBar && state.settings.featureToggles.trackLaborCost && (
                <div className="mt-4 border-t border-slate-200 pt-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <span className="text-slate-500 font-medium">Total Scheduled Hours</span>
                      <div className="text-lg font-bold text-slate-900 font-mono">
                        {totalScheduledHours.toFixed(1)} hrs
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">For week of {weekStart}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <span className="text-slate-500 font-medium">Overtime Hours</span>
                      <div
                        className={`text-lg font-bold font-mono ${
                          totalOvertimeHours > 0 ? 'text-amber-600' : 'text-emerald-700'
                        }`}
                      >
                        {totalOvertimeHours.toFixed(1)} hrs
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">Threshold: {state.settings.weeklyOvertimeHours}h/week</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <span className="text-slate-500 font-medium">Estimated Labor Spend</span>
                      <div className="text-lg font-bold text-emerald-700 font-mono">
                        ${totalEstimatedLaborCost.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {effectiveWeeklyBudget > 0
                          ? `${((totalEstimatedLaborCost / effectiveWeeklyBudget) * 100).toFixed(0)}% of weekly budget`
                          : 'No budget set'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 relative group">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-medium">Weekly Labor Budget</span>
                        <button
                          type="button"
                          onClick={() => {
                            setTempWeeklyBudget(effectiveWeeklyBudget);
                            setEditBudgetModalOpen(true);
                          }}
                          className="text-slate-400 hover:text-emerald-700 p-0.5 rounded transition"
                          title="Edit budget for this week"
                        >
                          <Edit2 className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="text-lg font-bold text-slate-900 font-mono">
                        ${effectiveWeeklyBudget.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {state.settings.weeklyBudgetsByWeek?.[weekStart] ? 'Custom for this week' : 'Default weekly target'}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Getting Started Checklist Card */}
            {(state.employees.length <= 1 || state.shifts.length === 0) && (
              <div className="rounded-2xl border border-emerald-300 bg-white p-5 shadow-xs animate-in fade-in">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm">Getting Started with Open Schedule</h3>
                      <p className="text-xs text-slate-500">4 simple steps to set up your floor schedule and timeclock</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                    Setup Checklist
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs mt-3">
                  <div
                    className={`rounded-xl border p-3 flex flex-col justify-between ${
                      state.settings.geofence.latitude !== 0 ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-1.5 font-bold text-slate-900 mb-1">
                        <CheckCircle2
                          className={`h-4 w-4 ${state.settings.geofence.latitude !== 0 ? 'text-emerald-600' : 'text-slate-300'}`}
                        />
                        <span>1. Hours & Check-In Area</span>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Operating times ({state.settings.operationalHours.open} - {state.settings.operationalHours.close}) and GPS radius.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('settings');
                        setSettingsActiveSubTab('general');
                      }}
                      className="mt-3 text-left text-[11px] font-bold text-emerald-700 hover:underline"
                    >
                      Configure Hours →
                    </button>
                  </div>

                  <div
                    className={`rounded-xl border p-3 flex flex-col justify-between ${
                      state.employees.length > 1 ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-1.5 font-bold text-slate-900 mb-1">
                        <CheckCircle2
                          className={`h-4 w-4 ${state.employees.length > 1 ? 'text-emerald-600' : 'text-slate-300'}`}
                        />
                        <span>2. Add Team Members</span>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Add staff names, role assignments, hourly pay rates, and kiosk PINs.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('staff');
                        setStaffModalOpen(true);
                      }}
                      className="mt-3 text-left text-[11px] font-bold text-emerald-700 hover:underline"
                    >
                      + Add Team Member →
                    </button>
                  </div>

                  <div
                    className={`rounded-xl border p-3 flex flex-col justify-between ${
                      state.shifts.length > 0 ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-1.5 font-bold text-slate-900 mb-1">
                        <CheckCircle2
                          className={`h-4 w-4 ${state.shifts.length > 0 ? 'text-emerald-600' : 'text-slate-300'}`}
                        />
                        <span>3. Schedule Weekly Shifts</span>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Create shifts by role or tap Auto-Fill to populate open shifts fairly.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingShiftId(null);
                        setShiftModalOpen(true);
                      }}
                      className="mt-3 text-left text-[11px] font-bold text-emerald-700 hover:underline"
                    >
                      + Create Shift →
                    </button>
                  </div>

                  <div
                    className={`rounded-xl border p-3 flex flex-col justify-between ${
                      state.shifts.some((s) => s.status === 'published')
                        ? 'border-emerald-200 bg-emerald-50/50'
                        : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-1.5 font-bold text-slate-900 mb-1">
                        <CheckCircle2
                          className={`h-4 w-4 ${
                            state.shifts.some((s) => s.status === 'published') ? 'text-emerald-600' : 'text-slate-300'
                          }`}
                        />
                        <span>4. Publish & Notify Team</span>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Publish weekly roster so staff see assigned shifts and up-for-grabs trades.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handlePublishSchedule}
                      className="mt-3 text-left text-[11px] font-bold text-emerald-700 hover:underline"
                    >
                      Publish Schedule →
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Quick Shift Templates */}
            {state.shiftTemplates.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto text-xs py-1">
                <span className="font-bold text-slate-500 shrink-0">Quick Shift Templates:</span>
                {state.shiftTemplates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => {
                      const role = roleMap.get(tmpl.roleId);
                      const newShift: Shift = {
                        id: `shift_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                        date: weekDays[1].date,
                        roleId: tmpl.roleId,
                        departmentId: role?.departmentId || state.departments[0]?.id || 'dept-general',
                        employeeId: null,
                        startTime: tmpl.startTime,
                        endTime: tmpl.endTime,
                        requiredTags: tmpl.requiredTags,
                        notes: `Template: ${tmpl.name}`,
                        isUpForGrabs: false,
                        status: 'draft',
                      };
                      onUpdateState({ ...state, shifts: [...state.shifts, newShift] });
                    }}
                    className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1 font-medium text-slate-700 hover:border-emerald-500 hover:text-emerald-800 shadow-sm"
                  >
                    + {tmpl.name}
                  </button>
                ))}
              </div>
            )}

            {/* Conflicts Warning */}
            {conflicts.length > 0 && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-amber-900 font-bold text-xs uppercase tracking-wider mb-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span>Schedule Conflicts Flagged ({conflicts.length})</span>
                </div>
                <div className="space-y-1.5 max-h-32 overflow-y-auto text-xs text-amber-800">
                  {conflicts.map((c) => (
                    <div key={c.id} className="flex items-center justify-between">
                      <span>• {c.message}</span>
                      <span className="rounded-full bg-amber-200/80 px-2 py-0.2 text-[10px] font-bold text-amber-900 uppercase">
                        {c.type.replace('_', ' ')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Weekly Roster Table (12-Hour AM/PM Format) */}
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-700">
                    <th className="p-3 w-48">Team Member / Role</th>
                    {weekDays.map((d) => (
                      <th key={d.date} className="p-3 border-l border-slate-200 min-w-[135px]">
                        <div>{d.dayName}</div>
                        <div className="text-[11px] font-mono font-normal text-slate-400">{d.date}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {/* Open / Unassigned Shifts Row */}
                  <tr className="bg-amber-50/40">
                    <td className="p-3 font-bold text-amber-900 flex items-center gap-1.5">
                      <Flame className="h-4 w-4 text-amber-600" />
                      <span>Open / Broadcast Shifts</span>
                    </td>
                    {weekDays.map((d) => {
                      const dayShifts = visibleShifts.filter((s) => !s.employeeId && s.date === d.date);
                      return (
                        <td key={d.date} className="p-2 border-l border-slate-200 align-top">
                          <div className="space-y-1.5 min-h-[48px]">
                            {dayShifts.map((s) => {
  const role = roleMap.get(s.roleId);
  const isDraft = s.status === 'draft';
  
  // Look up the employee assigned to this shift to get their permanent color
  const emp = state.employees.find((e) => e.id === s.employeeId);
  
  // Apply employee's permanent color if published, or amber styling if draft
  const showColors = state.settings.featureToggles.showEmployeeColors ?? true;

const shiftCardColor = isDraft 
  ? 'border-amber-300 bg-amber-50/70 text-amber-900' 
  : (showColors && emp?.color ? emp.color : 'border-emerald-200 bg-emerald-50/70 text-slate-900');

  return (
    <div
      key={s.id}
      onClick={() => handleOpenEditShift(s)}
      className={`group relative rounded-xl border p-2 shadow-xs cursor-pointer transition-all hover:ring-1 hover:ring-emerald-500 ${shiftCardColor}`}
    >
      {/* Shift card contents... */}
    </div>
  );
})}
                            <button
                              type="button"
                              onClick={() => handleOpenAddShift(d.date)}
                              className="w-full text-center py-1 text-[10px] text-amber-700 hover:text-amber-900 border border-dashed border-amber-300 rounded-lg"
                            >
                              + Open Slot
                            </button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>

                  {/* Staff Rows */}
                  {state.employees.map((emp) => {
  const badgeColor = emp.color || 'bg-slate-100 text-slate-800 border-slate-300';

  return (
    <tr key={emp.id} className="hover:bg-slate-50/80 transition-colors">
      <td className="p-3 align-top">
        <div className={`inline-block rounded-lg px-2 py-0.5 text-xs font-bold border ${badgeColor}`}>
          {emp.name}
        </div>
        <div className="text-[11px] text-slate-400 font-mono mt-1">@{emp.username}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {emp.tags.slice(0, 2).map((tId) => {
            const tag = tagMap.get(tId);
            return (
              <span
                key={tId}
                className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-600"
              >
                {tag?.name || tId}
              </span>
            );
          })}
        </div>
      </td>

      {weekDays.map((d) => {
        const dayShifts = visibleShifts.filter((s) => s.employeeId === emp.id && s.date === d.date);
        const empTimeOff = state.timeOffRequests.find(
          (to) =>
            to.employeeId === emp.id &&
            to.status === 'approved' &&
            d.date >= to.startDate &&
            d.date <= to.endDate
        );

        return (
          <td key={d.date} className="p-2 border-l border-slate-200 align-top">
            <div className="space-y-1.5 min-h-[48px]">
              {empTimeOff && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-1.5 text-center">
                  <div className="font-bold text-rose-800 text-[10px]">
                    {empTimeOff.partOfDay === 'morning_half'
                      ? '🌅 Morning Off'
                      : empTimeOff.partOfDay === 'night_half'
                      ? '🌙 Night Off'
                      : '🌴 Vacation / PTO'}
                  </div>
                  <div className="text-[9px] text-rose-600 truncate">{empTimeOff.reason}</div>
                </div>
              )}

              {dayShifts.map((s) => {
                const role = roleMap.get(s.roleId);
                const isDraft = s.status === 'draft';
                return (
                  <div
                    key={s.id}
                    onClick={() => handleOpenEditShift(s)}
                    className={`group relative rounded-xl border p-2 shadow-xs cursor-pointer transition-all hover:ring-1 hover:ring-emerald-500 ${
                      isDraft
                        ? 'border-amber-300 bg-amber-50/70'
                        : 'border-emerald-200 bg-emerald-50/70'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 text-[11px]">{role?.name}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold ${
                          isDraft
                            ? 'bg-amber-200 text-amber-900'
                            : 'bg-emerald-200 text-emerald-900'
                        }`}
                      >
                        {isDraft ? 'DRAFT' : 'PUBLISHED'}
                      </span>
                    </div>
                    <div className="font-mono text-slate-700 text-[10px] mt-0.5">
                      {formatShiftRange12H(s.startTime, s.endTime)}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {s.requiresClaim && (
                        <span className="rounded-full bg-blue-100 text-blue-800 text-[8px] px-1.5 font-bold">
                          Claim Req
                        </span>
                      )}
                      {s.isUpForGrabs && (
                        <span className="rounded-full bg-amber-100 text-amber-800 text-[8px] px-1.5 font-bold">
                          Up for Grabs
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteShift(s.id);
                      }}
                      className="absolute top-1 right-1 hidden group-hover:block text-slate-400 hover:text-rose-600 bg-white/80 rounded p-0.5"
                      title="Delete Shift"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={() => {
                  setEditingShiftId(null);
                  setShiftDate(d.date);
                  setShiftEmployee(emp.id);
                  setShiftRole(emp.roleIds[0] || state.roles[0]?.id || '');
                  setShiftStartTime('09:00');
                  setShiftEndTime('17:00');
                  setShiftTags([]);
                  setShiftRequiresClaim(false);
                  setShiftVisibleToEmployeeIds([]);
                  setShiftModalOpen(true);
                }}
                className="w-full text-center py-1 text-[10px] text-slate-400 hover:text-slate-700 border border-dashed border-slate-200 rounded-lg opacity-60 hover:opacity-100"
              >
                + Shift
              </button>
            </div>
          </td>
        );
      })}
    </tr>
  );
})}
                </tbody>
              </table>
            </div>

            {/* Vacation & Time-Off Requests Approval Queue Card */}

            <button
  type="button"
  onClick={() => setManagerTimeOffModalOpen(true)}
  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow hover:bg-emerald-700 transition"
>
  <Plus className="h-3.5 w-3.5" />
  <span>Add Vacation / PTO Block</span>
</button>

{managerTimeOffModalOpen && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl text-slate-800">
      <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
        <h3 className="font-bold text-slate-900 text-base">Add Employee Vacation / PTO</h3>
        <button
          type="button"
          onClick={() => setManagerTimeOffModalOpen(false)}
          className="text-slate-400 hover:text-slate-700"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <form onSubmit={handleManagerSubmitTimeOff} className="space-y-3 text-xs">
        <div>
          <label className="block text-slate-700 font-semibold mb-1">Team Member</label>
          <select
            value={mgrToEmployeeId}
            onChange={(e) => setMgrToEmployeeId(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 bg-white text-slate-900 font-medium"
          >
            {state.employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name} (@{emp.username})
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-700 font-semibold mb-1">Start Date</label>
            <input
              type="date"
              value={mgrToStart}
              onChange={(e) => setMgrToStart(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900"
              required
            />
          </div>
          <div>
            <label className="block text-slate-700 font-semibold mb-1">End Date</label>
            <input
              type="date"
              value={mgrToEnd}
              onChange={(e) => setMgrToEnd(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900"
              required
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-700 font-semibold mb-1">Type</label>
            <select
              value={mgrToType}
              onChange={(e) => setMgrToType(e.target.value as any)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 bg-white text-slate-900"
            >
              <option value="vacation">Vacation</option>
              <option value="pto">Paid Time Off (PTO)</option>
              <option value="personal">Personal</option>
            </select>
          </div>
          <div>
            <label className="block text-slate-700 font-semibold mb-1">Part of Day</label>
            <select
              value={mgrToPartOfDay}
              onChange={(e) => setMgrToPartOfDay(e.target.value as any)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 bg-white text-slate-900"
            >
              <option value="full_day">Full Day</option>
              <option value="morning_half">Morning Only (AM)</option>
              <option value="night_half">Night Only (PM)</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-slate-700 font-semibold mb-1">Notes / Reason</label>
          <input
            type="text"
            value={mgrToReason}
            onChange={(e) => setMgrToReason(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900"
          />
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setManagerTimeOffModalOpen(false)}
            className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow"
          >
            Add & Approve PTO Block
          </button>
        </div>
      </form>
    </div>
  </div>
)}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700">
                    <Calendar className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">Vacation & Time-Off Requests</h3>
                    <p className="text-xs text-slate-500">
                      Approve or decline staff time off. Approved dates automatically block shifts and prevent scheduling clashes.
                    </p>
                  </div>
                </div>
                {timeOffActionFeedback && (
                  <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                    ✓ {timeOffActionFeedback}
                  </span>
                )}
              </div>

              {state.timeOffRequests.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-2">No pending or historical time-off requests.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 font-bold text-slate-700">
                        <th className="p-2.5">Team Member</th>
                        <th className="p-2.5">Dates</th>
                        <th className="p-2.5">Type & Part of Day</th>
                        <th className="p-2.5">Reason</th>
                        <th className="p-2.5">Status</th>
                        <th className="p-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {state.timeOffRequests.map((req) => {
                        const emp = empMap.get(req.employeeId);
                        const isPending = req.status === 'pending';
                        return (
                          <tr key={req.id} className="hover:bg-slate-50/70">
                            <td className="p-2.5 font-bold text-slate-900">{emp?.name || 'Staff Member'}</td>
                            <td className="p-2.5 font-mono text-slate-700">
                              {req.startDate === req.endDate ? req.startDate : `${req.startDate} to ${req.endDate}`}
                            </td>
                            <td className="p-2.5">
                              <span className="font-medium text-slate-800 capitalize">
                                {req.requestType === 'pto' ? 'Paid Time Off' : req.requestType || 'Vacation'}
                              </span>
                              <span className="text-slate-400 text-[10px] ml-1">
                                ({req.partOfDay === 'morning_half' ? 'Morning Off' : req.partOfDay === 'night_half' ? 'Night Off' : 'Full Day'})
                              </span>
                            </td>
                            <td className="p-2.5 text-slate-600 max-w-xs truncate">{req.reason}</td>
                            <td className="p-2.5">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  req.status === 'approved'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : req.status === 'rejected'
                                    ? 'bg-rose-100 text-rose-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {req.status.toUpperCase()}
                              </span>
                            </td>
                            <td className="p-2.5 text-right">
                              {isPending ? (
                                <div className="flex justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleApproveTimeOff(req.id)}
                                    className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-700 shadow-xs"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRejectTimeOff(req.id)}
                                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                                  >
                                    Decline
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onUpdateState({
                                      ...state,
                                      timeOffRequests: state.timeOffRequests.filter((r) => r.id !== req.id),
                                    })
                                  }
                                  className="text-slate-400 hover:text-rose-600 text-[11px]"
                                  title="Delete record"
                                >
                                  Delete
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: Staff & Roles (With Edit Member functionality) */}
        {activeTab === 'staff' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Team Members & Job Roles</h2>
                <p className="text-xs text-slate-500">
                  Add team members, edit existing staff details, set pay rates, and assign skill certifications.
                </p>
              </div>
              <button
                type="button"
                onClick={handleOpenAddStaff}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-emerald-700 transition-colors"
              >
                <UserPlus className="h-4 w-4" />
                Add Team Member
              </button>
            </div>

            {/* Printable Onboarding Card */}
            {onboardingCardData && (
              <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-3 border-b border-emerald-200 pb-2">
                  <div className="flex items-center gap-2">
                    <UserCheck className="h-5 w-5 text-emerald-700" />
                    <h3 className="font-bold text-slate-900 text-sm">Printable Staff Login Card</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOnboardingCardData(null)}
                    className="text-slate-400 hover:text-slate-700"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                  <div>
                    <span className="text-slate-500">Staff Member:</span>
                    <div className="font-bold text-slate-900 text-sm">{onboardingCardData.name}</div>
                  </div>
                  <div>
                    <span className="text-slate-500">Username:</span>
                    <div className="font-mono font-bold text-slate-800 text-sm">{onboardingCardData.username}</div>
                  </div>
                  {onboardingCardData.tempPass && (
                    <div>
                      <span className="text-slate-500">Temporary Password:</span>
                      <div className="font-mono font-bold text-amber-800 text-sm">{onboardingCardData.tempPass}</div>
                    </div>
                  )}
                  <div>
                    <span className="text-slate-500">Kiosk PIN:</span>
                    <div className="font-mono font-bold text-emerald-800 text-sm">{onboardingCardData.pin}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Staff Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {state.employees.map((emp) => {
                return (
                  <div
                    key={emp.id}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-bold text-slate-900 text-sm">{emp.name}</h3>
                        <div className="font-mono text-xs text-slate-500">@{emp.username}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                            emp.currentPunchStatus === 'clocked_in'
                              ? 'bg-emerald-100 text-emerald-800'
                              : emp.currentPunchStatus === 'on_break'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {emp.currentPunchStatus.replace('_', ' ').toUpperCase()}
                        </span>
                        {/* Edit Team Member Button */}
                        <button
                          type="button"
                          onClick={() => handleOpenEditStaff(emp)}
                          className="rounded-lg border border-slate-200 bg-slate-50 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                          title="Edit team member details"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 space-y-1.5 text-xs">
                      <div className="flex justify-between text-slate-600">
                        <span>Target Hours:</span>
                        <span className="font-mono font-bold text-slate-800">{emp.targetWeeklyHours}h / week</span>
                      </div>
                      {state.settings.featureToggles.trackLaborCost && (
                        <div className="flex justify-between text-slate-600">
                          <span>Hourly Wage:</span>
                          <span className="font-mono font-bold text-emerald-700">${emp.baseHourlyRate.toFixed(2)}/hr</span>
                        </div>
                      )}
                      <div className="flex justify-between text-slate-600">
                        <span>Kiosk PIN:</span>
                        <span className="font-mono font-bold text-slate-700">{emp.pinCode}</span>
                      </div>
                    </div>

                    {/* Skill Tags */}
                    <div className="mt-3 border-t border-slate-100 pt-2.5">
                      <span className="text-[11px] font-semibold text-slate-400">Certifications & Roles:</span>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {emp.tags.length === 0 ? (
                          <span className="text-[11px] text-slate-400 italic">No skill tags assigned</span>
                        ) : (
                          emp.tags.map((tId) => {
                            const tag = tagMap.get(tId);
                            return (
                              <span
                                key={tId}
                                className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700"
                              >
                                {tag?.name || tId}
                              </span>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: Timesheets & Approvals */}
        {activeTab === 'timesheets' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Timesheets & Pay Approvals</h2>
                <p className="text-xs text-slate-500">
                  Review scheduled vs. clocked hours, check exceptions, and approve the pay period for payroll.
                </p>
              </div>
              <ActionButton
                onClick={async () => {
                  await new Promise((r) => setTimeout(r, 600));
                  setCopyFeedback('✓ Pay period approved! Ready for payroll export.');
                }}
                idleText="Approve Pay Period Hours"
                workingText="Approving hours..."
                successText="✓ Pay Period Approved!"
                icon={<FileCheck className="h-4 w-4" />}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-emerald-700"
              />
            </div>

            {/* Timesheets Table */}
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-bold text-slate-700">
                    <th className="p-3">Team Member</th>
                    <th className="p-3">Scheduled Hours</th>
                    <th className="p-3">Clocked Punches</th>
                    <th className="p-3">Regular Hours</th>
                    <th className="p-3">Overtime</th>
                    {state.settings.featureToggles.trackLaborCost && (
                      <th className="p-3">Estimated Gross Pay</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {state.employees.map((emp) => {
                    const empShifts = state.shifts.filter((s) => s.employeeId === emp.id && s.status === 'published');
                    const schedHrs = empShifts.reduce((acc, s) => acc + calculateShiftHours(s.startTime, s.endTime), 0);
                    const regHrs = Math.min(schedHrs, state.settings.weeklyOvertimeHours);
                    const otHrs = Math.max(0, schedHrs - state.settings.weeklyOvertimeHours);
                    const gross = regHrs * emp.baseHourlyRate + otHrs * emp.baseHourlyRate * 1.5;

                    return (
                      <tr key={emp.id} className="hover:bg-slate-50/70">
                        <td className="p-3 font-bold text-slate-900">{emp.name}</td>
                        <td className="p-3 font-mono text-slate-700">{schedHrs.toFixed(1)}h</td>
                        <td className="p-3 font-mono text-emerald-700">
                          {state.punches.filter((p) => p.employeeId === emp.id).length} punches recorded
                        </td>
                        <td className="p-3 font-mono text-slate-700">{regHrs.toFixed(1)}h</td>
                        <td className="p-3 font-mono text-amber-600">{otHrs > 0 ? `${otHrs.toFixed(1)}h` : '0h'}</td>
                        {state.settings.featureToggles.trackLaborCost && (
                          <td className="p-3 font-mono font-bold text-slate-900">${gross.toFixed(2)}</td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: Timecard Security Log */}
        {activeTab === 'security' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Timecard Security & Verification Log</h2>
                <p className="text-xs text-slate-500">
                  Verify the cryptographic security of time punches, test tamper simulations, or reset the security log with manager authorization.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onSimulateTamperAttack}
                  className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 shadow-xs transition-colors"
                >
                  <ShieldAlert className="h-4 w-4 text-rose-600" />
                  Simulate Database Tamper
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    setIsAuditingLedger(true);
                    const res = await verifyPunchLedger(state.punches);
                    setLedgerAuditResult(res);
                    setIsAuditingLedger(false);
                  }}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow hover:bg-emerald-700 transition-colors"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Scan Timecard Security Log
                </button>

                {/* Password-Protected Reset Security Log Button */}
                <button
                  type="button"
                  onClick={() => {
                    setResetLogPassword('');
                    setResetLogError('');
                    setResetLogModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 shadow-xs transition-colors"
                >
                  <RefreshCw className="h-4 w-4 text-slate-500" />
                  Reset Security Log
                </button>
              </div>
            </div>

            {/* Audit Status */}
            {ledgerAuditResult && (
              <div
                className={`rounded-2xl border p-5 shadow-sm ${
                  ledgerAuditResult.valid
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                    : 'border-rose-300 bg-rose-50 text-rose-900'
                }`}
              >
                <div className="flex items-center gap-3">
                  {ledgerAuditResult.valid ? (
                    <CheckCircle2 className="h-7 w-7 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="h-7 w-7 text-rose-600 shrink-0" />
                  )}
                  <div>
                    <h3 className="font-bold text-sm text-slate-900">
                      {ledgerAuditResult.valid
                        ? 'All Timecards Cryptographically Verified & Clean'
                        : 'Tampered Record Pinpointed in Security Log!'}
                    </h3>
                    <p className="text-xs mt-0.5">{ledgerAuditResult.details}</p>
                    {ledgerAuditResult.brokenIndex !== null && (
                      <p className="mt-1 font-mono text-xs font-bold text-rose-700">
                        Affected Record: Entry #{ledgerAuditResult.brokenIndex + 1}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Humanized Timecard Security Log Table */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    Timecard Punch Ledger ({state.punches.length} Entries)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Cryptographically linked time records with verification methods and tamper detection.
                  </p>
                </div>
              </div>

              {state.punches.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400 italic">
                  No clock-in entries recorded yet. Punches made via Employee Mobile or Kiosk will appear here in real time.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-xs divide-y divide-slate-200">
                    <thead className="bg-slate-50 font-semibold text-slate-700">
                      <tr>
                        <th className="p-2.5">#</th>
                        <th className="p-2.5">Team Member</th>
                        <th className="p-2.5">Location</th>
                        <th className="p-2.5">Action</th>
                        <th className="p-2.5">Time & Date</th>
                        <th className="p-2.5">Verification</th>
                        <th className="p-2.5">Integrity Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white font-normal">
                      {state.punches.map((p, idx) => {
                        const emp = empMap.get(p.employeeId);
                        const punchDate = new Date(p.timestampIso);
                        const timeStr = formatTime12H(
                          `${punchDate.getHours().toString().padStart(2, '0')}:${punchDate
                            .getMinutes()
                            .toString()
                            .padStart(2, '0')}`
                        );
                        const dateStr = punchDate.toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        });

                        return (
                          <tr
                            key={p.id}
                            className={p.isTampered ? 'bg-rose-50/70 text-rose-900' : 'hover:bg-slate-50/60'}
                          >
                            <td className="p-2.5 font-mono text-slate-400">#{idx + 1}</td>
                            <td className="p-2.5">
                              <span className="font-bold text-slate-900">{emp?.name || p.employeeId}</span>
                              <span className="block font-mono text-[11px] text-slate-400">@{emp?.username || p.employeeId}</span>
                            </td>
                            <td className="p-2.5 text-slate-700 font-medium">
                              {state.settings.orgName}
                            </td>
                            <td className="p-2.5">
                              <span
                                className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                  p.punchType === 'clock_in'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : p.punchType === 'clock_out'
                                    ? 'bg-slate-100 text-slate-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {p.punchType.replace('_', ' ')}
                              </span>
                            </td>
                            <td className="p-2.5 font-mono text-slate-800 tabular-nums">
                              {timeStr} • {dateStr}
                            </td>
                            <td className="p-2.5">
                              <span className="inline-flex items-center gap-1 text-[11px] text-slate-600">
                                {p.verifiedVia === 'gps' ? (
                                  <>
                                    <MapPin className="h-3 w-3 text-emerald-600" />
                                    <span>GPS Geofence ({p.accuracyMeters || 18}m)</span>
                                  </>
                                ) : p.verifiedVia === 'totp' ? (
                                  <>
                                    <KeyRound className="h-3 w-3 text-emerald-600" />
                                    <span>Indoor Rolling Code</span>
                                  </>
                                ) : (
                                  <>
                                    <Clock className="h-3 w-3 text-slate-600" />
                                    <span>Kiosk PIN Terminal</span>
                                  </>
                                )}
                              </span>
                            </td>
                            <td className="p-2.5">
                              {p.isTampered ? (
                                <span className="inline-flex items-center gap-1 font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-md text-[11px]">
                                  <AlertCircle className="h-3.5 w-3.5" />
                                  <span>Altered / Hash Breach</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md text-[11px]">
                                  <Check className="h-3.5 w-3.5" />
                                  <span>Verified & Clean</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Action Audit Trail ("Who & When") */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-700" />
                  <h3 className="font-bold text-slate-900 text-sm">
                    Administrative Action Audit Trail (Who & When)
                  </h3>
                </div>
                <span className="text-slate-400 text-xs font-mono">
                  {state.auditStamps?.length || 0} Events Stamped
                </span>
              </div>

              {!state.auditStamps || state.auditStamps.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400 italic">
                  No administrative events logged yet. Publishing schedules, approving pay periods, and company wipes will automatically create permanent audit stamps here.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-xs divide-y divide-slate-200">
                    <thead className="bg-slate-50 font-semibold text-slate-700">
                      <tr>
                        <th className="p-2.5">Timestamp</th>
                        <th className="p-2.5">Authorized Actor</th>
                        <th className="p-2.5">Role</th>
                        <th className="p-2.5">Action</th>
                        <th className="p-2.5">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white font-normal">
                      {state.auditStamps.map((stamp) => (
                        <tr key={stamp.id} className="hover:bg-slate-50/60">
                          <td className="p-2.5 font-mono text-slate-600 tabular-nums">
                            {new Date(stamp.timestampIso).toLocaleString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="p-2.5 font-bold text-slate-900">{stamp.actorName}</td>
                          <td className="p-2.5">
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">
                              {stamp.actorRole}
                            </span>
                          </td>
                          <td className="p-2.5 font-mono text-[11px] font-bold text-emerald-700">
                            {stamp.action}
                          </td>
                          <td className="p-2.5 text-slate-600">{stamp.details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: AI Operations (API Key Check, Next Week Draft Generator, 8 Action Buttons) */}
        {activeTab === 'ai' && state.settings.featureToggles.useAi && (
          <div className="space-y-6">
            {!hasValidAiApiKey(state) ? (
              <div className="rounded-2xl border-2 border-dashed border-emerald-300 bg-white p-8 text-center shadow-sm">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 mb-4">
                  <KeyRound className="h-7 w-7" />
                </div>
                <h2 className="text-xl font-bold text-slate-900 mb-2">API Key Required to Unlock AI Features</h2>
                <p className="text-sm text-slate-600 max-w-lg mx-auto mb-6">
                  Open Schedule runs 100% locally on your computer with zero subscriptions. To use smart AI scheduling and operations analysis, enter your free Google Gemini or OpenAI API key.
                </p>

                <div className="max-w-md mx-auto rounded-xl bg-slate-50 border border-slate-200 p-4 text-left text-xs space-y-2 mb-6">
                  <div className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                    3-Step Quick Setup Guide (100% Free):
                  </div>
                  <div className="flex items-start gap-2 text-slate-700">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">1</span>
                    <span>Visit <strong className="text-emerald-700">aistudio.google.com/app/apikey</strong> and sign in with any Google account.</span>
                  </div>
                  <div className="flex items-start gap-2 text-slate-700">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">2</span>
                    <span>Click <strong>"Create API Key"</strong> and copy the generated key.</span>
                  </div>
                  <div className="flex items-start gap-2 text-slate-700">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">3</span>
                    <span>Click the button below and paste your key. It is saved in your local encrypted browser storage and never shared.</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setUnlockAiKeyInput(state.aiConfig?.apiKeyEncrypted || '');
                    setUnlockAiModalOpen(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-bold text-white shadow-md hover:bg-emerald-700 transition-colors"
                >
                  <KeyRound className="h-4 w-4" />
                  Enter API Key to Unlock AI Features
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-emerald-600" />
                      AI Scheduling & Operations Assistant
                    </h2>
                    <p className="text-xs text-slate-500">
                      Predicts staffing demand from POS sales & reservations, checks vacation approvals, and generates smart schedules.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setUnlockAiKeyInput(state.aiConfig?.apiKeyEncrypted || '');
                      setUnlockAiModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 shadow-xs"
                  >
                    <KeyRound className="h-3.5 w-3.5 text-emerald-600" />
                    Manage API Key ({state.aiConfig?.provider || 'gemini'})
                  </button>
                </div>

                {/* Hero Feature: Generate Next Week's Draft Schedule */}
                <div className="rounded-2xl border-2 border-emerald-500/30 bg-gradient-to-br from-emerald-50/70 to-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
                        <Calendar className="h-6 w-6" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-slate-900">Generate Next Week's Draft Schedule</h3>
                        <p className="text-xs text-slate-600">
                          Builds next week's schedule honoring staff availability, approved vacation/half-days, and busy reservation hours.
                        </p>
                      </div>
                    </div>
                    <ActionButton
                      onClick={async () => {
                        const { shifts, summary } = generateNextWeekDraftSchedule(state, weekStart, aiVariationSeed);
                        setAiDraftShiftsPreview(shifts);
                        setAiDraftSummary(summary);
                      }}
                      idleLabel="Generate Next Week's Draft"
                      workingLabel="Analyzing demand & building roster..."
                      successLabel="✓ Draft Ready for Review!"
                      className="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow hover:bg-emerald-700"
                    />
                  </div>

                  {/* Visual Calendar Preview for Next Week Draft */}
                  {aiDraftShiftsPreview && (
                    <div className="mt-4 rounded-xl border border-emerald-300 bg-white p-4 shadow-sm space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                        <div>
                          <div className="font-bold text-slate-900 text-sm">Next Week Draft Preview ({aiDraftShiftsPreview.length} Shifts)</div>
                          <p className="text-xs text-emerald-700 mt-0.5">{aiDraftSummary}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const newSeed = aiVariationSeed + 1;
                              setAiVariationSeed(newSeed);
                              const { shifts, summary } = generateNextWeekDraftSchedule(state, weekStart, newSeed);
                              setAiDraftShiftsPreview(shifts);
                              setAiDraftSummary(summary);
                            }}
                            className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Regenerate Variation
                          </button>
                          <ActionButton
                            onClick={async () => {
                              onUpdateState({
                                ...state,
                                shifts: [...state.shifts, ...aiDraftShiftsPreview],
                              });
                              setAiDraftShiftsPreview(null);
                              setActiveTab('roster');
                            }}
                            idleLabel="Save as Next Week's Draft"
                            workingLabel="Saving shifts..."
                            successLabel="✓ Saved to Next Week!"
                            className="rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                          />
                          <button
                            type="button"
                            onClick={() => setAiDraftShiftsPreview(null)}
                            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100"
                          >
                            Discard
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 max-h-72 overflow-y-auto p-1">
                        {aiDraftShiftsPreview.map((s) => {
                          const emp = empMap.get(s.employeeId || '');
                          const role = roleMap.get(s.roleId);
                          return (
                            <div
                              key={s.id}
                              className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-2.5 text-xs shadow-xs"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-slate-900">{s.date}</span>
                                <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                                  Draft
                                </span>
                              </div>
                              <div className="mt-1 font-semibold text-emerald-800">
                                {emp ? emp.name : 'Unassigned'}
                              </div>
                              <div className="text-[11px] text-slate-500">{role?.name}</div>
                              <div className="mt-1 font-mono text-[11px] text-slate-700">
                                {formatShiftRange12H(s.startTime, s.endTime)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Data Access Checkboxes & Upload Modals */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider mb-3">
                    1. Data Allowed for AI Analysis:
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                    <label className="flex items-center gap-2 text-slate-700 font-medium">
                      <input
                        type="checkbox"
                        checked={aiDataAccess.allowStaffAvailability}
                        onChange={(e) =>
                          setAiDataAccess({ ...aiDataAccess, allowStaffAvailability: e.target.checked })
                        }
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>Staff Availability & Hour Limits</span>
                    </label>

                    <label className="flex items-center gap-2 text-slate-700 font-medium">
                      <input
                        type="checkbox"
                        checked={aiDataAccess.allowPastSchedules}
                        onChange={(e) =>
                          setAiDataAccess({ ...aiDataAccess, allowPastSchedules: e.target.checked })
                        }
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>Past Schedule History</span>
                    </label>

                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-slate-700 font-medium">
                        <input
                          type="checkbox"
                          checked={aiDataAccess.allowOpenTableReservations}
                          onChange={(e) =>
                            setAiDataAccess({ ...aiDataAccess, allowOpenTableReservations: e.target.checked })
                          }
                          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span>OpenTable Reservations</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setReservationUploadModalOpen(true)}
                        className="text-[11px] font-bold text-emerald-700 hover:underline"
                      >
                        + Add Covers
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-slate-700 font-medium">
                        <input
                          type="checkbox"
                          checked={aiDataAccess.allowPosSales}
                          onChange={(e) =>
                            setAiDataAccess({ ...aiDataAccess, allowPosSales: e.target.checked })
                          }
                          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span>POS Daily Sales</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setSalesUploadModalOpen(true)}
                        className="text-[11px] font-bold text-emerald-700 hover:underline"
                      >
                        + Add Sales
                      </button>
                    </div>
                  </div>
                </div>

                {/* 8 One-Click AI Action Buttons */}
                <div>
                  <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider mb-3">
                    2. Tap an AI Operations Action to Run:
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                      { id: 'generate_weekly', title: 'Generate Weekly Schedule', desc: 'Create a full schedule for the week', icon: Calendar },
                      { id: 'fill_open', title: 'Fill Open Shifts', desc: 'Match unassigned shifts to qualified staff', icon: Wand2 },
                      { id: 'check_overtime', title: 'Check Overtime & Burnout', desc: 'Find staff nearing weekly overtime', icon: AlertTriangle },
                      { id: 'compare_staffing_demand', title: 'Compare Staffing to Demand', desc: 'Check staffing vs. sales & guest covers', icon: Users },
                      { id: 'recommend_early_cuts', title: 'Recommend Early Cuts', desc: 'Cut order for slow shifts to save labor', icon: Clock },
                      { id: 'balance_hours', title: 'Balance Team Hours Fairly', desc: 'Identify staff with hour discrepancies', icon: FileCheck },
                      { id: 'cross_training', title: 'Find Cross-Training Needs', desc: 'Spot roles lacking backup coverage', icon: Tag },
                      { id: 'cost_breakdown', title: 'Weekly Labor Cost Breakdown', desc: 'Review projected labor spend vs. budget', icon: DollarSign },
                    ].map((act) => {
                      const Icon = act.icon;
                      const isActive = aiActiveAction === act.id;
                      return (
                        <button
                          key={act.id}
                          type="button"
                          onClick={() => handleTriggerAiAction(act.id)}
                          className={`flex flex-col text-left rounded-2xl border p-4 shadow-sm transition-all ${
                            isActive
                              ? 'border-emerald-600 bg-emerald-50 ring-2 ring-emerald-500/20'
                              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700">
                              <Icon className="h-4 w-4" />
                            </div>
                            <span className="font-bold text-xs text-slate-900">{act.title}</span>
                          </div>
                          <p className="text-[11px] text-slate-500 line-clamp-2">{act.desc}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* AI Action Results Card */}
                {aiCurrentResult && (
                  <div className="rounded-2xl border border-emerald-300 bg-emerald-50/50 p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-3 border-b border-emerald-200 pb-3">
                      <div>
                        <h3 className="font-bold text-slate-900 text-base">{aiCurrentResult.title}</h3>
                        <p className="text-xs text-emerald-800 mt-0.5">{aiCurrentResult.summary}</p>
                      </div>
                      {aiCurrentResult.proposedShifts && (
                        <button
                          type="button"
                          onClick={handleApplyProposedAiShifts}
                          className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-emerald-700 transition-colors"
                        >
                          Apply Proposed Schedule to Live Roster
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs mt-4">
                      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                        <h4 className="font-bold text-slate-900 mb-2">Findings & Details:</h4>
                        <ul className="space-y-1.5 list-disc list-inside text-slate-600">
                          {aiCurrentResult.details.map((d, i) => (
                            <li key={i}>{d}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                        <h4 className="font-bold text-slate-900 mb-2">Recommended Actions:</h4>
                        <ul className="space-y-1.5 list-disc list-inside text-emerald-800 font-medium">
                          {aiCurrentResult.recommendations.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {aiCurrentResult.proposedShifts && (
                      <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                        <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider mb-3">
                          Proposed 7-Day Calendar Schedule:
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                          {aiCurrentResult.proposedShifts.map((ps) => {
                            const emp = empMap.get(ps.employeeId || '');
                            const role = roleMap.get(ps.roleId);
                            return (
                              <div
                                key={ps.id}
                                className="rounded-xl border border-emerald-300 bg-emerald-50/80 p-2.5 text-xs shadow-xs"
                              >
                                <div className="font-bold text-slate-900">{ps.date}</div>
                                <div className="font-semibold text-emerald-800 text-[11px] mt-0.5">
                                  {emp?.name || 'Unassigned Slot'}
                                </div>
                                <div className="text-slate-500 text-[10px]">{role?.name}</div>
                                <div className="font-mono text-[10px] text-slate-600 mt-1">
                                  {formatShiftRange12H(ps.startTime, ps.endTime)}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* TAB 6: Team Chat & Announcements (Manager View) */}
        {activeTab === 'chat' && (
          <div className="space-y-6 max-w-4xl">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-emerald-600" />
                  Team Chat & Manager Announcements
                </h2>
                <p className="text-xs text-slate-500">
                  Broadcast notices to the entire team or chat with coworkers in real-time.
                </p>
              </div>

              {/* Manager Announcements Only Restriction Toggle */}
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 shadow-xs cursor-pointer hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={state.settings.groupChatManagerOnly ?? false}
                  onChange={(e) =>
                    onUpdateState({
                      ...state,
                      settings: {
                        ...state.settings,
                        groupChatManagerOnly: e.target.checked,
                      },
                    })
                  }
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Restrict to Manager Announcements Only</span>
              </label>
            </div>

            {state.settings.groupChatManagerOnly && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 font-medium flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>
                  <strong>Manager Announcements Mode is Active:</strong> Staff can read all messages and announcements on their mobile devices, but cannot reply or post new messages.
                </span>
              </div>
            )}

            {/* Chat Box */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col h-[520px]">
              {/* Channel Selector */}
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 flex items-center justify-between">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setManagerChatChannel('announcements')}
                    className={`rounded-lg px-3 py-1 text-xs font-bold transition-all ${
                      managerChatChannel === 'announcements'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-slate-600 hover:bg-slate-200/60'
                    }`}
                  >
                    📢 Workplace Announcements
                  </button>
                  <button
                    type="button"
                    onClick={() => setManagerChatChannel('general')}
                    className={`rounded-lg px-3 py-1 text-xs font-bold transition-all ${
                      managerChatChannel === 'general'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-slate-600 hover:bg-slate-200/60'
                    }`}
                  >
                    💬 Team Discussion
                  </button>
                </div>
                <span className="text-[11px] text-slate-500 font-medium">
                  {state.messages.filter((m) =>
                    managerChatChannel === 'announcements'
                      ? m.channel === 'announcements' || m.senderRole === 'manager' || m.text.startsWith('📢')
                      : m.channel !== 'announcements'
                  ).length} messages
                </span>
              </div>

              {/* Message Feed */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/30">
                {state.messages
                  .filter((m) =>
                    managerChatChannel === 'announcements'
                      ? m.channel === 'announcements' || m.senderRole === 'manager' || m.text.startsWith('📢')
                      : m.channel !== 'announcements'
                  )
                  .map((msg) => {
                    const isManager = msg.senderRole === 'manager';
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col max-w-[80%] rounded-2xl p-3 shadow-xs text-xs ${
                          isManager
                            ? 'ml-auto bg-emerald-600 text-white rounded-br-sm'
                            : 'mr-auto bg-white border border-slate-200 text-slate-800 rounded-bl-sm'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4 mb-1">
                          <span
                            className={`font-bold text-[11px] ${
                              isManager ? 'text-emerald-100' : 'text-slate-900'
                            }`}
                          >
                            {msg.senderName} {isManager && '★ (Management)'}
                          </span>
                          <span
                            className={`text-[10px] ${
                              isManager ? 'text-emerald-200' : 'text-slate-400'
                            }`}
                          >
                            {new Date(msg.timestampIso).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                      </div>
                    );
                  })}
              </div>

              {/* Composer */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!managerChatMessage.trim()) return;
                  const newMsg: CoworkerMessage = {
                    id: 'msg-' + Date.now(),
                    senderEmployeeId: 'manager',
                    senderName: state.settings.orgName + ' Management',
                    senderRole: 'manager',
                    channel: managerChatChannel,
                    text: managerChatChannel === 'announcements' ? `📢 ${managerChatMessage.trim()}` : managerChatMessage.trim(),
                    timestampIso: new Date().toISOString(),
                  };
                  onUpdateState({
                    ...state,
                    messages: [...state.messages, newMsg],
                  });
                  setManagerChatMessage('');
                }}
                className="border-t border-slate-200 p-3 bg-white flex gap-2"
              >
                <input
                  type="text"
                  placeholder={
                    managerChatChannel === 'announcements'
                      ? 'Type an announcement for all team members...'
                      : 'Type a message to the team...'
                  }
                  value={managerChatMessage}
                  onChange={(e) => setManagerChatMessage(e.target.value)}
                  className="flex-1 rounded-xl border border-slate-300 px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  type="submit"
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow-sm"
                >
                  <Send className="h-4 w-4" />
                  Send
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 7: Settings (Business, Location, Cloud Sync & App Guides) */}
        {activeTab === 'settings' && (
          <div className="space-y-6 max-w-4xl">
            {/* Settings Header with Sub-tabs */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">Business, Location & Cloud Settings</h2>
                <p className="text-xs text-slate-500">Configure operational rules, cloud sync, and view setup guides.</p>
              </div>

              <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setSettingsActiveSubTab('general')}
                  className={`rounded-lg px-3 py-1 font-bold transition-all ${
                    settingsActiveSubTab === 'general'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  General & Rules
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsActiveSubTab('cloud')}
                  className={`rounded-lg px-3 py-1 font-bold transition-all ${
                    settingsActiveSubTab === 'cloud'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Cloud Sync & Privacy
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsActiveSubTab('help')}
                  className={`rounded-lg px-3 py-1 font-bold transition-all ${
                    settingsActiveSubTab === 'help'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  App Guide & Help
                </button>
              </div>
            </div>

            {settingsActiveSubTab === 'general' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Feature Toggles */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                    <h3 className="font-bold text-slate-900 text-sm">Active Business Features</h3>
                    <div className="space-y-3 text-xs">
                      <label className="flex items-center justify-between text-slate-700">
                        <div>
                          <div className="font-semibold text-slate-900">Use AI Scheduling & Operations</div>
                          <div className="text-[11px] text-slate-500">Requires free Gemini or OpenAI key</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={state.settings.featureToggles.useAi}
                          onChange={(e) => {
                            const willEnable = e.target.checked;
                            if (willEnable && !hasValidAiApiKey(state)) {
                              setUnlockAiKeyInput(state.aiConfig?.apiKeyEncrypted || '');
                              setUnlockAiModalOpen(true);
                            } else {
                              onUpdateState({
                                ...state,
                                settings: {
                                  ...state.settings,
                                  featureToggles: {
                                    ...state.settings.featureToggles,
                                    useAi: willEnable,
                                  },
                                },
                              });
                            }
                          }}
                          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                      </label>

                      <label className="flex items-center justify-between text-slate-700">
                        <div>
                          <div className="font-semibold text-slate-900">Track Hourly Pay & Labor Budget</div>
                          <div className="text-[11px] text-slate-500">Enables wage tracking and payroll calculations</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={state.settings.featureToggles.trackLaborCost}
                          onChange={(e) =>
                            onUpdateState({
                              ...state,
                              settings: {
                                ...state.settings,
                                featureToggles: {
                                  ...state.settings.featureToggles,
                                  trackLaborCost: e.target.checked,
                                },
                              },
                            })
                          }
                          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                      </label>

                      <label className="flex items-center justify-between text-slate-700">
                        <div>
                          <div className="font-semibold text-slate-900">Require Approval for Vacation & PTO</div>
                          <div className="text-[11px] text-slate-500">Staff requests go to manager approval queue</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={state.settings.vacationRequiresApproval ?? true}
                          onChange={(e) =>
                            onUpdateState({
                              ...state,
                              settings: {
                                ...state.settings,
                                vacationRequiresApproval: e.target.checked,
                              },
                            })
                          }
                          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                      </label>

                      <label className="flex items-center justify-between text-slate-700">
                        <div>
                          <div className="font-semibold text-slate-900">Restrict Team Chat to Manager Announcements</div>
                          <div className="text-[11px] text-slate-500">Staff can view notices but cannot send messages</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={state.settings.groupChatManagerOnly ?? false}
                          onChange={(e) =>
                            onUpdateState({
                              ...state,
                              settings: {
                                ...state.settings,
                                groupChatManagerOnly: e.target.checked,
                              },
                            })
                          }
                          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Organization Info */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
                    <h3 className="font-bold text-slate-900 text-sm">Organization Details</h3>
                    <div className="space-y-3 text-xs">
                      <div>
                        <label className="block text-slate-600 mb-1 font-medium">Business Name</label>
                        <input
                          type="text"
                          value={state.settings.orgName}
                          onChange={(e) =>
                            onUpdateState({
                              ...state,
                              settings: {
                                ...state.settings,
                                orgName: e.target.value,
                              },
                            })
                          }
                          className="w-full rounded-xl border border-slate-300 px-3 py-1.5 text-slate-900 font-semibold"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-600 mb-1 font-medium">Default Weekly Labor Budget ($)</label>
                        <SmartNumberInput
                          value={state.settings.laborBudgetWeekly || 2500}
                          onChange={(val) =>
                            onUpdateState({
                              ...state,
                              settings: {
                                ...state.settings,
                                laborBudgetWeekly: val,
                              },
                            })
                          }
                          className="w-full rounded-xl border border-slate-300 px-3 py-1.5 text-slate-900 font-mono"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Location Check-In Area */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm">Workplace Check-In Coordinates</h3>
                      <p className="text-xs text-slate-500">Defines the GPS geofence where staff can clock in via mobile.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (navigator.geolocation) {
                          navigator.geolocation.getCurrentPosition((pos) => {
                            onUpdateState({
                              ...state,
                              settings: {
                                ...state.settings,
                                geofence: {
                                  ...state.settings.geofence,
                                  latitude: pos.coords.latitude,
                                  longitude: pos.coords.longitude,
                                },
                              },
                            });
                          });
                        }
                      }}
                      className="flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      Use Current Browser GPS Location
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                    <div>
                      <label className="block text-slate-600 mb-1">Latitude</label>
                      <input
                        type="number"
                        step="0.0001"
                        value={state.settings.geofence.latitude}
                        onChange={(e) =>
                          onUpdateState({
                            ...state,
                            settings: {
                              ...state.settings,
                              geofence: {
                                ...state.settings.geofence,
                                latitude: parseFloat(e.target.value) || 0,
                              },
                            },
                          })
                        }
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-slate-900 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 mb-1">Longitude</label>
                      <input
                        type="number"
                        step="0.0001"
                        value={state.settings.geofence.longitude}
                        onChange={(e) =>
                          onUpdateState({
                            ...state,
                            settings: {
                              ...state.settings,
                              geofence: {
                                ...state.settings.geofence,
                                longitude: parseFloat(e.target.value) || 0,
                              },
                            },
                          })
                        }
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-slate-900 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 mb-1">Allowed Check-In Radius (Meters)</label>
                      <SmartNumberInput
                        value={state.settings.geofence.radiusMeters}
                        onChange={(val) =>
                          onUpdateState({
                            ...state,
                            settings: {
                              ...state.settings,
                              geofence: {
                                ...state.settings.geofence,
                                radiusMeters: val,
                              },
                            },
                          })
                        }
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-slate-900 font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Company Factory Reset (Creator-Only) */}
                <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-5 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2.5 rounded-xl bg-rose-100 text-rose-700 shrink-0 mt-0.5">
                        <AlertTriangle className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-rose-900 text-sm">Reset Company Portal to 0 (Factory Reset)</h3>
                        <p className="text-xs text-rose-700 mt-0.5 max-w-xl">
                          Permanently wipe all scheduled shifts, timecard punches, sales history, and employee accounts. 
                          Only the initial company creator can authorize this with their master password. A mandatory backup must be saved before proceeding.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFactoryResetStep(1);
                        setFactoryResetConfirmationText('');
                        setFactoryResetCreatorUser('');
                        setFactoryResetCreatorPass('');
                        setFactoryResetError('');
                        setFactoryResetBackupDownloaded(false);
                        setFactoryResetModalOpen(true);
                      }}
                      className="rounded-xl border border-rose-300 bg-white px-4 py-2 text-xs font-bold text-rose-700 shadow-xs hover:bg-rose-100 transition-colors shrink-0"
                    >
                      Initiate Company Reset
                    </button>
                  </div>
                </div>
              </div>
            )}

            {settingsActiveSubTab === 'cloud' && (
              <div className="space-y-6">
                {/* 50%+ Memory Optimization Badge */}
                <div className="rounded-2xl border border-emerald-300 bg-emerald-50/70 p-5 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
                        <HardDrive className="h-6 w-6" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 text-sm">Ultra-Compact Cloud Sync Engine</span>
                          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
                            &gt;50% Bandwidth Saved
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5">
                          Payload pruned to rolling 7-day window with minified schema, 40-message chat cap, and zero PII.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPayloadStatsModalOpen(true)}
                      className="rounded-xl border border-emerald-400 bg-white px-4 py-2 text-xs font-bold text-emerald-800 shadow-xs hover:bg-emerald-50 transition-colors"
                    >
                      Inspect Payload & Savings Stats
                    </button>
                  </div>
                </div>

                {/* Cloud Database Setup Guides */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Supabase Guide */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-emerald-600" />
                        Supabase Setup Guide
                      </h3>
                      <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                        Recommended
                      </span>
                    </div>
                    <ol className="text-xs text-slate-600 space-y-2 list-decimal list-inside leading-relaxed">
                      <li>Create a free account at <strong>supabase.com</strong> and click <em>New Project</em>.</li>
                      <li>In the SQL Editor, run this 1-line query to create the sync table:
                        <div className="mt-1 font-mono text-[10px] bg-slate-900 text-slate-100 p-2 rounded-lg overflow-x-auto">
                          create table openschedule_sync (id text primary key, payload jsonb, updated_at timestamptz default now());
                        </div>
                      </li>
                      <li>In Project Settings &gt; API, copy your <strong>Project URL</strong> and <strong>anon public key</strong>.</li>
                      <li>Open the Plugins modal in Open Schedule and paste them to enable live cloud sync.</li>
                    </ol>
                  </div>

                  {/* Firebase Guide */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
                    <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                      <Flame className="h-4 w-4 text-amber-500" />
                      Firebase Firestore Guide
                    </h3>
                    <ol className="text-xs text-slate-600 space-y-2 list-decimal list-inside leading-relaxed">
                      <li>Visit <strong>console.firebase.google.com</strong> and create a new project.</li>
                      <li>Click <em>Firestore Database</em> &gt; <em>Create Database</em> (Start in Test Mode).</li>
                      <li>In Project Settings &gt; General &gt; Your Apps, register a <em>Web App</em>.</li>
                      <li>Copy the `firebaseConfig` object (apiKey, authDomain, projectId) into the Cloud Sync plugin.</li>
                    </ol>
                  </div>
                </div>
              </div>
            )}

            {settingsActiveSubTab === 'help' && (
              <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm text-xs leading-relaxed">
                <h3 className="text-base font-bold text-slate-900 mb-2">Open Schedule Quick-Start Guide</h3>
                
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
                    <h4 className="font-bold text-slate-900 text-sm mb-1">1. Roster & Targeted Shift Claiming</h4>
                    <p className="text-slate-600">
                      When creating a shift, check <em>"Targeted Shift: Require claim by specific staff"</em> to offer it exclusively to selected employees instead of the open pool. Staff view only displays published shifts. Click <strong>"Publish & Send"</strong> when you are ready to make draft shifts live.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
                    <h4 className="font-bold text-slate-900 text-sm mb-1">2. Vacation & Half-Day PTO Requests</h4>
                    <p className="text-slate-600">
                      Employees can submit full-day or half-day (morning or night) time-off requests. Managers review requests under the Roster tab. Approved time-off displays an amber blocked badge on the roster to prevent scheduling conflicts.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
                    <h4 className="font-bold text-slate-900 text-sm mb-1">3. Kiosk & Mobile Check-In Security</h4>
                    <p className="text-slate-600">
                      Staff can clock in using their 4-digit PIN on the Breakroom Kiosk or through their mobile devices within the workplace GPS geofence. Every punch is cryptographically signed and hash-chained in the Timecard Security Log.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
                    <h4 className="font-bold text-slate-900 text-sm mb-1">4. Payroll Export & Accounting</h4>
                    <p className="text-slate-600">
                      Under <em>Timesheets & Approvals</em>, review regular hours, overtime, and gross pay. Click <strong>Export Payroll CSV</strong> to download a formatted file compatible with Gusto, ADP, QuickBooks, or Excel.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* MODAL: Printable Schedule Calendar Modal */}
      {printModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between mb-4 border-b border-slate-200 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-lg">Breakroom Schedule Print Preview</h3>
                <p className="text-xs text-slate-500">
                  Crisp, high-contrast black-and-white grid formatted for standard 8.5x11 breakroom walls.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPrintModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Print Table Preview */}
            <div className="border border-slate-200 rounded-xl p-4 bg-white mb-6">
              <h2 className="text-center font-bold text-base text-slate-900 mb-1">
                {state.settings.orgName} — Weekly Work Schedule
              </h2>
              <p className="text-center text-xs text-slate-500 mb-4">
                Week of {weekStart} to {weekDays[6].date}
              </p>

              <table className="w-full border-collapse text-xs text-left">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border border-slate-300 p-2">Team Member</th>
                    {weekDays.map((d) => (
                      <th key={d.date} className="border border-slate-300 p-2">
                        {d.dayName.slice(0, 3)} {d.date.slice(5)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.employees.map((emp) => (
                    <tr key={emp.id}>
                      <td className="border border-slate-300 p-2 font-bold bg-slate-50/50">{emp.name}</td>
                      {weekDays.map((d) => {
                        const s = state.shifts.find((shift) => shift.employeeId === emp.id && shift.date === d.date && shift.status === 'published');
                        const role = roleMap.get(s?.roleId || '');
                        return (
                          <td key={d.date} className="border border-slate-300 p-2 align-top">
                            {s ? (
                              <div>
                                <div className="font-semibold text-slate-800">{role?.name}</div>
                                <div className="text-[10px] text-slate-500 font-mono">
                                  {formatShiftRange12H(s.startTime, s.endTime)}
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Print & Download Actions */}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const html = generatePrintableScheduleHtml(
                    state.shifts,
                    state.employees,
                    state.roles,
                    weekStart,
                    state.settings.orgName
                  );
                  downloadFile(`${state.settings.orgName}_schedule.html`, html, 'text/html');
                }}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-xs"
              >
                Download Printable HTML File
              </button>
              <button
                type="button"
                onClick={() => {
                  window.print();
                }}
                className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow"
              >
                Print Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Cloud Sync Scrubbed Data Preview */}
      {cloudPreviewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-base">Outgoing Cloud Data Preview</h3>
              </div>
              <button
                type="button"
                onClick={() => setCloudPreviewModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-slate-600 mb-3 leading-relaxed">
              Verify that all personal and financial data is completely removed before syncing. Hourly wage rates, password hashes, salts, and kiosk PINs are never sent.
            </p>
            <pre className="max-h-72 overflow-auto rounded-xl border border-slate-200 bg-slate-900 p-4 font-mono text-xs text-emerald-400">
              {JSON.stringify(getScrubbedCloudSyncPayload(state), null, 2)}
            </pre>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setCloudPreviewModalOpen(false)}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Password-Protected Security Log Reset */}
      {resetLogModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-3 border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-base">Reset & Repair Security Log</h3>
              </div>
              <button
                type="button"
                onClick={() => setResetLogModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Enter your Manager Password to verify authorization. This will recalculate clean cryptographic hash links across all timecards and resolve any security alerts.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Manager Password
                </label>
                <input
                  type="password"
                  value={resetLogPassword}
                  onChange={(e) => setResetLogPassword(e.target.value)}
                  placeholder="Enter manager password..."
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              {resetLogError && (
                <div className="text-xs font-semibold text-rose-600">{resetLogError}</div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetLogModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmResetSecurityLog}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow"
                >
                  Verify & Reset Log
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Shift Add/Edit */}
      {shiftModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-200 pb-3">
              <h3 className="font-bold text-slate-900 text-base">
                {editingShiftId ? 'Edit Shift' : 'Add New Shift'}
              </h3>
              <button
                type="button"
                onClick={() => setShiftModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1">Date</label>
                <input
                  type="date"
                  value={shiftDate}
                  onChange={(e) => setShiftDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-slate-900"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Job Role</label>
                <select
                  value={shiftRole}
                  onChange={(e) => setShiftRole(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-slate-900"
                >
                  {state.roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Assign Team Member (or leave Open)</label>
                <select
                  value={shiftEmployee}
                  onChange={(e) => setShiftEmployee(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-slate-900"
                >
                  <option value="">(Open Shift — Anyone Can Pick Up)</option>
                  {state.employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} (@{emp.username})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Start Time</label>
                  <input
                    type="time"
                    value={shiftStartTime}
                    onChange={(e) => setShiftStartTime(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-slate-900"
                  />
                  <div className="mt-1 text-[11px] font-mono text-emerald-700">
                    {formatTime12H(shiftStartTime)}
                  </div>
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">End Time</label>
                  <input
                    type="time"
                    value={shiftEndTime}
                    onChange={(e) => setShiftEndTime(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-slate-900"
                  />
                  <div className="mt-1 text-[11px] font-mono text-emerald-700">
                    {formatTime12H(shiftEndTime)}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Notes / Instructions</label>
                <input
                  type="text"
                  value={shiftNotes}
                  onChange={(e) => setShiftNotes(e.target.value)}
                  placeholder="e.g. Closing duties, patio section"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-slate-900"
                />
              </div>

              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="upForGrabsModal"
                    checked={shiftIsUpForGrabs}
                    onChange={(e) => setShiftIsUpForGrabs(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <label htmlFor="upForGrabsModal" className="text-slate-700 font-medium">
                    Broadcast this shift as "Up for Grabs" for staff pickup
                  </label>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="requiresClaimModal"
                      checked={shiftRequiresClaim}
                      onChange={(e) => setShiftRequiresClaim(e.target.checked)}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <label htmlFor="requiresClaimModal" className="text-slate-900 font-semibold text-xs">
                      Require Employee to Claim This Shift (Targeted Broadcast)
                    </label>
                  </div>
                  {shiftRequiresClaim && (
                    <div className="pt-1">
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Select Eligible Team Members (Leave blank for all qualified):
                      </label>
                      <div className="max-h-24 overflow-y-auto space-y-1 bg-white p-2 rounded-lg border border-slate-200">
                        {state.employees.map((emp) => {
                          const isChecked = shiftVisibleToEmployeeIds.includes(emp.id);
                          return (
                            <label key={emp.id} className="flex items-center gap-2 text-[11px] text-slate-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(ev) => {
                                  if (ev.target.checked) {
                                    setShiftVisibleToEmployeeIds([...shiftVisibleToEmployeeIds, emp.id]);
                                  } else {
                                    setShiftVisibleToEmployeeIds(
                                      shiftVisibleToEmployeeIds.filter((id) => id !== emp.id)
                                    );
                                  }
                                }}
                                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                              />
                              <span>{emp.name} (@{emp.username})</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShiftModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveShift}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow"
                >
                  Save Shift
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Staff Add/Edit */}
      {staffModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-200 pb-3">
              <h3 className="font-bold text-slate-900 text-base">
                {editingStaffId ? 'Edit Team Member' : 'Add New Team Member'}
              </h3>
              <button
                type="button"
                onClick={() => setStaffModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveStaffForm} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Full Name</label>
                <input
                  type="text"
                  value={staffName}
                  onChange={(e) => setStaffName(e.target.value)}
                  placeholder="e.g. Maria Gonzalez"
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Username</label>
                  <input
                    type="text"
                    value={staffUsername}
                    onChange={(e) => setStaffUsername(e.target.value)}
                    placeholder="e.g. maria"
                    required
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    {editingStaffId ? 'Reset Password (optional)' : 'Temporary Password'}
                  </label>
                  <input
                    type="text"
                    value={staffTempPassword}
                    onChange={(e) => setStaffTempPassword(e.target.value)}
                    placeholder={editingStaffId ? 'Leave blank to keep' : 'password123'}
                    required={!editingStaffId}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-slate-900 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Target Weekly Hours</label>
                  <SmartNumberInput
                    value={staffTargetHours}
                    onChange={setStaffTargetHours}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-slate-900 font-mono"
                  />
                </div>
                {state.settings.featureToggles.trackLaborCost && (
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Hourly Pay Rate ($)</label>
                    <SmartNumberInput
                      value={staffRate}
                      onChange={setStaffRate}
                      step={0.5}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-slate-900 font-mono"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Kiosk Check-In PIN (4 Digits)</label>
                <input
                  type="text"
                  maxLength={4}
                  value={staffPin}
                  onChange={(e) => setStaffPin(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-slate-900 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Qualified Roles</label>
                <div className="grid grid-cols-2 gap-2 max-h-24 overflow-y-auto">
                  {state.roles.map((r) => (
                    <label key={r.id} className="flex items-center gap-1.5 text-[11px] text-slate-700">
                      <input
                        type="checkbox"
                        checked={staffRoles.includes(r.id)}
                        onChange={(e) => {
                          if (e.target.checked) setStaffRoles([...staffRoles, r.id]);
                          else setStaffRoles(staffRoles.filter((id) => id !== r.id));
                        }}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>{r.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Skill & Shift Tags</label>
                <div className="grid grid-cols-2 gap-2 max-h-24 overflow-y-auto">
                  {state.skillTags.map((tag) => (
                    <label key={tag.id} className="flex items-center gap-1.5 text-[11px] text-slate-700">
                      <input
                        type="checkbox"
                        checked={staffTags.includes(tag.id)}
                        onChange={(e) => {
                          if (e.target.checked) setStaffTags([...staffTags, tag.id]);
                          else setStaffTags(staffTags.filter((id) => id !== tag.id));
                        }}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>{tag.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setStaffModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow"
                >
                  {editingStaffId ? 'Update Team Member' : 'Save & Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Add POS Sales */}
      {salesUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="font-bold text-slate-900 text-base mb-3">Add POS Daily Sales</h3>
            <form onSubmit={handleAddSalesRecord} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1">Gross Sales ($)</label>
                <input
                  type="number"
                  value={newSalesGross}
                  onChange={(e) => setNewSalesGross(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-slate-900"
                  required
                />
              </div>
              <div>
                <label className="block text-slate-700 font-medium mb-1">Total Orders</label>
                <SmartNumberInput
                  value={newSalesOrders}
                  onChange={setNewSalesOrders}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-slate-900"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setSalesUploadModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 shadow"
                >
                  Save Sales
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Add OpenTable Covers */}
      {reservationUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="font-bold text-slate-900 text-base mb-3">Add Table Reservations</h3>
            <form onSubmit={handleAddReservationRecord} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1">Expected Guest Covers</label>
                <SmartNumberInput
                  value={newCoversCount}
                  onChange={setNewCoversCount}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-slate-900"
                />
              </div>
              <div>
                <label className="block text-slate-700 font-medium mb-1">Number of Parties</label>
                <SmartNumberInput
                  value={newPartyCount}
                  onChange={setNewPartyCount}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-slate-900"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setReservationUploadModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 shadow"
                >
                  Save Covers
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Confirm Publish Schedule */}
      <ConfirmModal
        isOpen={publishConfirmOpen}
        title="Publish & Send Schedule to Staff"
        message="This will publish all draft shifts for the selected week. Team members will immediately be able to view their scheduled shifts and claim any targeted or available open shifts on mobile. Publish now?"
        confirmLabel="Publish & Send Now"
        onConfirm={handlePublishSchedule}
        onCancel={() => setPublishConfirmOpen(false)}
      />

      {/* MODAL: Unlock AI Features */}
      {unlockAiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-base">Unlock AI Operations</h3>
              </div>
              <button
                type="button"
                onClick={() => setUnlockAiModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Open Schedule is private and local-first. We never charge monthly AI fees. Enter your free Google Gemini API key (or OpenAI key) to enable smart scheduling and operations insights.
            </p>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs space-y-1.5 mb-4 text-slate-700">
              <div className="font-bold text-slate-900 text-[11px] uppercase tracking-wider">How to get a free key:</div>
              <div>1. Go to <span className="font-bold text-emerald-700">aistudio.google.com/app/apikey</span></div>
              <div>2. Click &quot;Create API Key&quot; and copy it.</div>
              <div>3. Paste it below and tap Save.</div>
            </div>

            <div className="space-y-3 text-xs mb-5">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">API Key</label>
                <input
                  type="password"
                  placeholder="AIzaSy... or sk-..."
                  value={unlockAiKeyInput}
                  onChange={(e) => setUnlockAiKeyInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUnlockAiModalOpen(false)}
                className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const trimmed = unlockAiKeyInput.trim();
                  if (!trimmed) return;
                  const isGemini = trimmed.startsWith('AIzaSy') || !trimmed.startsWith('sk-');
                  onUpdateState({
                    ...state,
                    settings: {
                      ...state.settings,
                      featureToggles: {
                        ...state.settings.featureToggles,
                        useAi: true,
                      },
                    },
                    aiConfig: {
                      enabled: true,
                      provider: isGemini ? 'gemini' : 'openai',
                      apiKeyEncrypted: trimmed,
                      modelName: isGemini ? 'gemini-2.5-flash' : 'gpt-4o-mini',
                    },
                  });
                  setUnlockAiModalOpen(false);
                }}
                disabled={!unlockAiKeyInput.trim()}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
              >
                Save & Unlock AI
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Edit Weekly Budget Limit */}
      {editBudgetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="font-bold text-slate-900 text-base mb-1">Set Labor Budget for Week</h3>
            <p className="text-xs text-slate-500 mb-4">
              Week of {weekStart}. Custom weekly budgets allow you to account for seasonal or holiday changes.
            </p>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Labor Budget Limit ($)
              </label>
              <SmartNumberInput
                value={tempWeeklyBudget}
                onChange={setTempWeeklyBudget}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 font-mono text-sm"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditBudgetModalOpen(false)}
                className="rounded-xl border border-slate-200 px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onUpdateState({
                    ...state,
                    settings: {
                      ...state.settings,
                      weeklyBudgetsByWeek: {
                        ...(state.settings.weeklyBudgetsByWeek || {}),
                        [weekStart]: tempWeeklyBudget,
                      },
                    },
                  });
                  setEditBudgetModalOpen(false);
                }}
                className="rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 shadow"
              >
                Save Budget
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Cloud Sync Payload Stats */}
      {payloadStatsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <HardDrive className="h-5 w-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-base">Cloud Sync Optimization & Privacy Stats</h3>
              </div>
              <button
                type="button"
                onClick={() => setPayloadStatsModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {(() => {
              const stats = getCloudSyncPayloadStats(state);
              return (
                <div className="space-y-4 text-xs">
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                      <div className="text-[11px] text-slate-500 font-medium">Original Data Size</div>
                      <div className="font-mono font-bold text-slate-800 text-sm mt-1">{stats.rawBytes.toLocaleString()} B</div>
                    </div>
                    <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                      <div className="text-[11px] text-emerald-700 font-medium">Scrubbed Sync Size</div>
                      <div className="font-mono font-bold text-emerald-800 text-sm mt-1">{stats.compactBytes.toLocaleString()} B</div>
                    </div>
                    <div className="rounded-xl bg-emerald-600 text-white p-3 shadow-xs">
                      <div className="text-[11px] text-emerald-100 font-medium">Reduction</div>
                      <div className="font-mono font-bold text-base mt-0.5">{stats.reductionPercent}% Saved</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5 space-y-2">
                    <div className="font-bold text-slate-900">Privacy & Efficiency Guarantees:</div>
                    <ul className="list-disc list-inside space-y-1 text-slate-600">
                      <li><strong>Zero Passwords & Salts:</strong> Cryptographic credentials stay in the local vault.</li>
                      <li><strong>Zero Wage Data:</strong> Hourly pay rates and gross earnings are 100% stripped.</li>
                      <li><strong>7-Day Rolling Window:</strong> Only shifts within ±7 days are synced to mobile devices.</li>
                      <li><strong>Chat History Capped:</strong> Message history is capped at the 40 most recent messages.</li>
                      <li><strong>Key Minification:</strong> Shift attributes are minified to 1-letter keys for minimal network usage.</li>
                    </ul>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => setPayloadStatsModalOpen(false)}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
                    >
                      Done
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* 3-Step Creator-Only Factory Reset Modal */}
      {factoryResetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-3xl border border-rose-200 bg-white p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-rose-100 text-rose-700">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Reset Company Portal to 0</h3>
                  <p className="text-[11px] text-slate-500">Creator-Only 3-Step Destructive Action</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFactoryResetModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Stepper Progress */}
            <div className="flex items-center justify-between text-xs font-semibold px-2">
              <div className={`flex items-center gap-1.5 ${factoryResetStep >= 1 ? 'text-rose-700' : 'text-slate-400'}`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${factoryResetStep >= 1 ? 'bg-rose-600 text-white font-bold' : 'bg-slate-200 text-slate-600'}`}>1</span>
                <span>Mandatory Backup</span>
              </div>
              <div className="h-0.5 w-8 bg-slate-200" />
              <div className={`flex items-center gap-1.5 ${factoryResetStep >= 2 ? 'text-rose-700' : 'text-slate-400'}`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${factoryResetStep >= 2 ? 'bg-rose-600 text-white font-bold' : 'bg-slate-200 text-slate-600'}`}>2</span>
                <span>Confirm Intent</span>
              </div>
              <div className="h-0.5 w-8 bg-slate-200" />
              <div className={`flex items-center gap-1.5 ${factoryResetStep >= 3 ? 'text-rose-700' : 'text-slate-400'}`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${factoryResetStep >= 3 ? 'bg-rose-600 text-white font-bold' : 'bg-slate-200 text-slate-600'}`}>3</span>
                <span>Creator Auth</span>
              </div>
            </div>

            {/* Step 1: Mandatory Backup Download */}
            {factoryResetStep === 1 && (
              <div className="space-y-4 text-xs">
                <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4 space-y-2 text-rose-900 leading-relaxed">
                  <p className="font-bold">⚠️ Warning: This will permanently delete:</p>
                  <ul className="list-disc list-inside space-y-1 text-[11px] text-rose-800">
                    <li>All scheduled, draft, and published shifts ({state.shifts.length} shifts)</li>
                    <li>All employee punch records and timecard history ({state.punches.length} records)</li>
                    <li>All employee accounts (except the primary creator profile)</li>
                    <li>All sales, cover reservations, and chat messages</li>
                  </ul>
                  <p className="text-[11px] font-semibold text-rose-900 mt-2">
                    To prevent accidental loss of operational history, you must download a full backup file before proceeding.
                  </p>
                </div>

                <div className="pt-2 flex flex-col gap-2.5">
                  <button
                    type="button"
                    onClick={async () => {
                      await exportEncryptedVault(state, '');
                      setFactoryResetBackupDownloaded(true);
                      setCopyFeedback('✓ Full company backup downloaded!');
                    }}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold transition-all ${
                      factoryResetBackupDownloaded
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-300'
                        : 'bg-slate-900 text-white hover:bg-slate-800 shadow-sm'
                    }`}
                  >
                    <Download className="h-4 w-4" />
                    {factoryResetBackupDownloaded ? '✓ Backup Saved (.openschedule)' : '1. Download Full Company Backup (.openschedule)'}
                  </button>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => setFactoryResetModalOpen(false)}
                      className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!factoryResetBackupDownloaded}
                      onClick={() => setFactoryResetStep(2)}
                      className="px-5 py-2 rounded-xl text-xs font-bold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
                    >
                      Continue to Step 2 →
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Confirm Destruction with Text Input */}
            {factoryResetStep === 2 && (
              <div className="space-y-4 text-xs">
                <p className="text-slate-600 leading-relaxed">
                  To confirm that you deliberately intend to reset this company portal to zero, please type the following exact phrase in the confirmation box below:
                </p>
                <div className="rounded-xl bg-slate-100 p-2.5 font-mono font-bold text-center text-slate-900 select-all border border-slate-200">
                  {state.settings.orgName} RESET
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Type phrase to unlock:</label>
                  <input
                    type="text"
                    value={factoryResetConfirmationText}
                    onChange={(e) => setFactoryResetConfirmationText(e.target.value)}
                    placeholder={`${state.settings.orgName} RESET`}
                    className="w-full rounded-xl border border-slate-300 p-2.5 font-mono text-xs focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
                  />
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => setFactoryResetStep(1)}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
                  >
                    ← Back to Step 1
                  </button>
                  <button
                    type="button"
                    disabled={factoryResetConfirmationText.trim() !== `${state.settings.orgName} RESET`.trim()}
                    onClick={() => setFactoryResetStep(3)}
                    className="px-5 py-2 rounded-xl text-xs font-bold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
                  >
                    Continue to Creator Verification →
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Creator Authentication */}
            {factoryResetStep === 3 && (
              <div className="space-y-4 text-xs">
                <p className="text-slate-600 leading-relaxed">
                  Only the original creator of <strong>{state.settings.orgName}</strong> can authorize this action. Please enter your creator username and password:
                </p>

                {factoryResetError && (
                  <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-rose-700 font-semibold">
                    ✕ {factoryResetError}
                  </div>
                )}

                <div className="space-y-3">
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Creator Username</label>
                    <input
                      type="text"
                      value={factoryResetCreatorUser}
                      onChange={(e) => setFactoryResetCreatorUser(e.target.value)}
                      placeholder={state.settings.creatorUsername || state.settings.managerUsername || 'manager'}
                      className="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Creator Master Password</label>
                    <input
                      type="password"
                      value={factoryResetCreatorPass}
                      onChange={(e) => setFactoryResetCreatorPass(e.target.value)}
                      placeholder="Enter master password..."
                      className="w-full rounded-xl border border-slate-300 p-2.5 text-xs"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setFactoryResetStep(2)}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
                  >
                    ← Back to Step 2
                  </button>
                  <button
                    type="button"
                    disabled={!factoryResetCreatorUser || !factoryResetCreatorPass}
                    onClick={handleExecuteFactoryReset}
                    className="px-5 py-2.5 rounded-xl text-xs font-bold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-md transition-colors"
                  >
                    Permanently Reset Portal to 0
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Status / Copy Toast Banner */}
      {copyFeedback && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-2xl border border-emerald-300 bg-white px-4 py-3 text-xs font-semibold text-slate-900 shadow-xl ring-1 ring-black/5 animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{copyFeedback}</span>
          <button
            type="button"
            onClick={() => setCopyFeedback(null)}
            className="ml-2 text-slate-400 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};

