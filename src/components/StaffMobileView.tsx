/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coffee,
  Download,
  Eye,
  EyeOff,
  Flame,
  Globe,
  HandMetal,
  KeyRound,
  Lock,
  LogOut,
  MapPin,
  MessageSquare,
  Navigation,
  Play,
  Send,
  Shield,
  Smartphone,
  User,
  Users,
  X,
} from 'lucide-react';
import {
  AvailabilityBlock,
  AvailabilityPreference,
  CoworkerMessage,
  Employee,
  OrganizationSettings,
  OrganizationState,
  PunchType,
  Shift,
  TimeOffRequest,
  TimePunch,
} from '../types';
import {
  computePunchHash,
  getDeviceId,
  hashPassword,
  verifyRollingTotp,
  GENESIS_PUNCH_HASH,
} from '../cryptoEngine';
import {
  calculateShiftHours,
  formatShiftRange12H,
  formatTime12H,
  getDayOfWeek,
  getWeekDays,
} from '../schedulerEngine';
import { generateIcsCalendar, downloadFile } from '../calendarAndExport';
import { ActionButton, ConfirmModal } from './SmartInputs';

interface StaffMobileViewProps {
  state: OrganizationState;
  currentEmployee: Employee;
  onUpdateEmployee: (updated: Employee) => void;
  onRecordPunch: (punch: TimePunch, updatedEmployee: Employee) => void;
  onClaimShift: (shiftId: string, employeeId: string) => void;
  onPostShiftUpForGrabs: (shiftId: string) => void;
  onAddAvailability: (block: AvailabilityBlock) => void;
  onDeleteAvailability: (blockId: string) => void;
  onSubmitTimeOff: (request: TimeOffRequest) => void;
  onSendMessage: (msg: CoworkerMessage) => void;
  onStaffLogout: () => void;
  gpsSimMeters?: number;
  workspaces?: Record<string, OrganizationState>;
  onSwitchWorkspace?: (orgId: string) => void;
}

export const StaffMobileView: React.FC<StaffMobileViewProps> = ({
  state,
  currentEmployee,
  onUpdateEmployee,
  onRecordPunch,
  onClaimShift,
  onPostShiftUpForGrabs,
  onAddAvailability,
  onDeleteAvailability,
  onSubmitTimeOff,
  onSendMessage,
  onStaffLogout,
  gpsSimMeters = 20,
  workspaces,
  onSwitchWorkspace,
}) => {
  const [activeTab, setActiveTab] = useState<'timeclock' | 'myschedule' | 'deptschedule' | 'upforgrabs' | 'availability' | 'chat'>('timeclock');
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [totpInput, setTotpInput] = useState<string>('');
  const [totpError, setTotpError] = useState<string>('');
  const [showPin, setShowPin] = useState<boolean>(false);
  const [geofenceAlertDismissed, setGeofenceAlertDismissed] = useState<boolean>(false);

  // My Account drawer state
  const [myAccountOpen, setMyAccountOpen] = useState<boolean>(false);
  const [accountUsername, setAccountUsername] = useState<string>(currentEmployee.username);
  const [accountNewPassword, setAccountNewPassword] = useState<string>('');
  const [accountConfirmPassword, setAccountConfirmPassword] = useState<string>('');
  const [accountFeedback, setAccountFeedback] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  // First-login password change state
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string>('');

  // Time off state
  const [timeOffStart, setTimeOffStart] = useState<string>('');
  const [timeOffEnd, setTimeOffEnd] = useState<string>('');
  const [timeOffReason, setTimeOffReason] = useState<string>('');
  const [timeOffType, setTimeOffType] = useState<'vacation' | 'pto' | 'personal'>('vacation');
  const [timeOffPartOfDay, setTimeOffPartOfDay] = useState<'full_day' | 'morning_half' | 'night_half'>('full_day');
  const [timeOffSuccessMsg, setTimeOffSuccessMsg] = useState<string>('');
  const [presenceModalOpen, setPresenceModalOpen] = useState<boolean>(false);

  // Chat conversation target: null = "Team Group Chat", string = employeeId for 1-on-1 direct message
  const [chatRecipientId, setChatRecipientId] = useState<string | null>(null);
  const [chatText, setChatText] = useState<string>('');

  // Team Weekly Calendar state
  const [teamCalendarWeekStart, setTeamCalendarWeekStart] = useState<string>(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day;
    const sun = new Date(now.setDate(diff));
    return sun.toISOString().slice(0, 10);
  });
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  // Anti-Buddy-Punch Logout Confirmation Modal
  const [showLogoutConfirm, setShowLogoutConfirm] = useState<boolean>(false);

  // Handle saving My Account (Username and/or Password changes)
  const handleSaveAccountChanges = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccountError(null);
    setAccountFeedback(null);

    const cleanUser = accountUsername.trim().toLowerCase();
    if (!cleanUser) {
      setAccountError('Username cannot be empty.');
      return;
    }

    // Check collision if username changed
    if (cleanUser !== currentEmployee.username.toLowerCase()) {
      const exists = state.employees.some(
        (emp) => emp.id !== currentEmployee.id && emp.username.toLowerCase() === cleanUser
      );
      if (exists) {
        setAccountError(`The username "${cleanUser}" is already taken by another team member.`);
        return;
      }
    }

    let nextHash = currentEmployee.passwordHash;
    let nextSalt = currentEmployee.saltHex;

    if (accountNewPassword) {
      if (accountNewPassword.length < 6) {
        setAccountError('New password must be at least 6 characters.');
        return;
      }
      if (accountNewPassword !== accountConfirmPassword) {
        setAccountError('Passwords do not match.');
        return;
      }
      const hashed = await hashPassword(accountNewPassword);
      nextHash = hashed.hashHex;
      nextSalt = hashed.saltHex;
    }

    const updated: Employee = {
      ...currentEmployee,
      username: cleanUser,
      passwordHash: nextHash,
      saltHex: nextSalt,
    };

    onUpdateEmployee(updated);
    setAccountFeedback('✓ Account updated successfully!');
    setAccountNewPassword('');
    setAccountConfirmPassword('');
    setTimeout(() => {
      setAccountFeedback(null);
      setMyAccountOpen(false);
    }, 1200);
  };

  const isClockedIn = currentEmployee.currentPunchStatus === 'clocked_in';
  const isOnBreak = currentEmployee.currentPunchStatus === 'on_break';
  const isClockedOut = currentEmployee.currentPunchStatus === 'clocked_out';

  // Timer loop for active shift
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isClockedIn && currentEmployee.activePunchStartIso) {
      const startMs = new Date(currentEmployee.activePunchStartIso).getTime();
      interval = setInterval(() => {
        const secs = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
        setElapsedSeconds(secs);
      }, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => clearInterval(interval);
  }, [isClockedIn, currentEmployee.activePunchStartIso]);

  // Geofence check
  const geofenceRadius = state.settings.geofence.radiusMeters || 75;
  const isInsideGeofence = gpsSimMeters <= geofenceRadius;
  const showGeofenceExitAlert = !isInsideGeofence && (isClockedIn || isOnBreak) && !geofenceAlertDismissed;

  // Handle first-login password change
  const handleSaveNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }

    const { hashHex, saltHex } = await hashPassword(newPassword);
    const updated: Employee = {
      ...currentEmployee,
      passwordHash: hashHex,
      saltHex: saltHex,
      requiresPasswordChange: false,
    };
    onUpdateEmployee(updated);
  };

  // Verify Kiosk Code (120 seconds / 2 minutes)
  const handleVerifyTotp = async () => {
    setTotpError('');
    if (!totpInput || totpInput.trim().length < 4) {
      setTotpError('Please enter the 4-digit or 6-digit code shown on the Kiosk screen.');
      return;
    }

    const digits = state.settings.totpDigits || 6;
    const isValid = await verifyRollingTotp(totpInput.trim(), state.settings.totpSecretHex, digits, 120);
    if (isValid) {
      const updated: Employee = {
        ...currentEmployee,
        kioskCodeVerified: true,
      };
      onUpdateEmployee(updated);
      setTotpError('');
      setTotpInput('');
    } else {
      setTotpError('Incorrect or expired code. Please check the Kiosk screen and try again.');
    }
  };

  // Execute Punch
  const handlePunch = async (type: PunchType): Promise<boolean> => {
    const isPresenceVerified = isInsideGeofence || currentEmployee.kioskCodeVerified;
    if (!isPresenceVerified && type === 'clock_in') {
      setPresenceModalOpen(true);
      return false;
    }

    const nowIso = new Date().toISOString();
    const prevHash =
      state.punches.length > 0 ? state.punches[state.punches.length - 1].hash : GENESIS_PUNCH_HASH;

    const shiftId = currentEmployee.activeShiftId || null;
    const computedHash = await computePunchHash(
      prevHash,
      currentEmployee.id,
      shiftId,
      type,
      nowIso
    );

    const deviceId = getDeviceId();
    const newPunch: TimePunch = {
      id: `punch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      employeeId: currentEmployee.id,
      shiftId: shiftId,
      punchType: type,
      timestampIso: nowIso,
      prevHash,
      hash: computedHash,
      latitude: state.settings.geofence.latitude,
      longitude: state.settings.geofence.longitude,
      accuracyMeters: gpsSimMeters,
      verifiedVia: isInsideGeofence ? 'gps' : 'totp',
      deviceId,
    };

    let nextStatus: 'clocked_in' | 'on_break' | 'clocked_out' = 'clocked_out';
    let nextPunchStart = currentEmployee.activePunchStartIso;
    let nextBreakStart = currentEmployee.activeBreakStartIso;

    if (type === 'clock_in') {
      nextStatus = 'clocked_in';
      nextPunchStart = nowIso;
      nextBreakStart = null;
    } else if (type === 'break_start') {
      nextStatus = 'on_break';
      nextBreakStart = nowIso;
    } else if (type === 'break_end') {
      nextStatus = 'clocked_in';
      nextBreakStart = null;
    } else if (type === 'clock_out') {
      nextStatus = 'clocked_out';
      nextPunchStart = null;
      nextBreakStart = null;
    }

    const updated: Employee = {
      ...currentEmployee,
      currentPunchStatus: nextStatus,
      activePunchStartIso: nextPunchStart,
      activeBreakStartIso: nextBreakStart,
      activeSessionDeviceId: nextStatus !== 'clocked_out' ? deviceId : null,
      kioskCodeVerified: nextStatus !== 'clocked_out' ? currentEmployee.kioskCodeVerified : false,
    };

    onRecordPunch(newPunch, updated);
    return true;
  };

  const handleConfirmLogout = () => {
    if (isClockedIn || isOnBreak) {
      handlePunch('clock_out');
    }
    setShowLogoutConfirm(false);
    onStaffLogout();
  };

  const handleExportMyCalendar = () => {
    const myShifts = state.shifts.filter(
      (s) => s.employeeId === currentEmployee.id && s.status === 'published'
    );
    const icsContent = generateIcsCalendar(
      myShifts,
      state.roles,
      state.settings.orgName,
      `${currentEmployee.name} - ${state.settings.orgName} Schedule`
    );
    downloadFile(
      `${currentEmployee.username}_schedule.ics`,
      icsContent,
      'text/calendar;charset=utf-8'
    );
  };

  const handleSubmitTimeOffForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!timeOffStart || !timeOffEnd || !timeOffReason) return;
    const req: TimeOffRequest = {
      id: `to_${Date.now()}`,
      employeeId: currentEmployee.id,
      startDate: timeOffStart,
      endDate: timeOffEnd,
      reason: timeOffReason,
      requestType: timeOffType,
      partOfDay: timeOffPartOfDay,
      status: state.settings.vacationRequiresApproval ? 'pending' : 'approved',
      submittedAtIso: new Date().toISOString(),
    };
    onSubmitTimeOff(req);
    setTimeOffStart('');
    setTimeOffEnd('');
    setTimeOffReason('');
    setTimeOffSuccessMsg('Your time-off request was submitted to your manager!');
    setTimeout(() => setTimeOffSuccessMsg(''), 4000);
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatText.trim()) return;
    const msg: CoworkerMessage = {
      id: `msg_${Date.now()}`,
      senderEmployeeId: currentEmployee.id,
      senderName: currentEmployee.name,
      recipientEmployeeId: chatRecipientId,
      text: chatText.trim(),
      timestampIso: new Date().toISOString(),
      channel: chatRecipientId ? 'direct' : 'general',
    };
    onSendMessage(msg);
    setChatText('');
  };

  // Staff only see PUBLISHED shifts. Draft shifts remain completely private to management.
  const myShifts = state.shifts
    .filter((s) => s.employeeId === currentEmployee.id && s.status === 'published')
    .sort((a, b) => a.date.localeCompare(b.date));

  // Shift Market: Only published shifts. Honors targeted shift claiming.
  const upForGrabsShifts = state.shifts.filter((s) => {
    if (s.status !== 'published') return false;
    if (s.employeeId === currentEmployee.id) return false;

    // Targeted shift claim
    if (s.requiresClaim) {
      if (s.visibleToEmployeeIds && s.visibleToEmployeeIds.length > 0) {
        return s.visibleToEmployeeIds.includes(currentEmployee.id);
      }
      return true;
    }

    return s.isUpForGrabs || !s.employeeId;
  });

  const roleMap = new Map(state.roles.map((r) => [r.id, r]));
  const tagMap = new Map(state.skillTags.map((t) => [t.id, t]));

  // Messages filtered for current chat target
  const filteredMessages = state.messages.filter((m) => {
    if (!chatRecipientId) {
      // Group chat
      return !m.recipientEmployeeId;
    }
    // 1-on-1 direct message between currentEmployee and selected recipient
    return (
      (m.senderEmployeeId === currentEmployee.id && m.recipientEmployeeId === chatRecipientId) ||
      (m.senderEmployeeId === chatRecipientId && m.recipientEmployeeId === currentEmployee.id)
    );
  });

  const teamWeekDays = getWeekDays(teamCalendarWeekStart);
  const selectedDateShifts = state.shifts.filter(
    (s) => s.date === selectedCalendarDate && s.status === 'published' && s.employeeId
  );

  // First-login password change gate
  if (currentEmployee.requiresPasswordChange) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 text-slate-900">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
          <div className="flex items-center gap-3 border-b border-slate-200 pb-4 mb-4">
            <div className="rounded-xl bg-emerald-100 p-2 text-emerald-700">
              <KeyRound className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Create Your Password</h2>
              <p className="text-xs text-slate-500">
                Welcome, {currentEmployee.name}! Please set your personal password.
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveNewPassword} className="space-y-4">
            <p className="text-xs text-slate-600 leading-relaxed">
              Your manager gave you a temporary password. Choose a private password only you know to protect your account.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                New Password (at least 6 characters)
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                placeholder="••••••••"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Confirm New Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                placeholder="••••••••"
                required
              />
            </div>

            {passwordError && (
              <div className="text-xs font-semibold text-rose-600">{passwordError}</div>
            )}

            <button
              type="submit"
              className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white shadow hover:bg-emerald-700 transition-colors"
            >
              Save Password & Enter App
            </button>
          </form>
        </div>
      </div>
    );
  }

  const formatSeconds = (totalSecs: number) => {
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="flex min-h-full flex-col bg-slate-50 text-slate-800 select-none pb-4">
      {/* Top Header */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <Smartphone className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-slate-900 leading-tight">{state.settings.orgName}</h1>
              {workspaces && Object.keys(workspaces).length > 1 && onSwitchWorkspace && (
                <select
                  value={state.orgId || ''}
                  onChange={(e) => onSwitchWorkspace(e.target.value)}
                  className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 rounded-lg border border-emerald-200 px-2 py-0.5 max-w-[130px] truncate"
                >
                  {Object.values(workspaces).map((w) => (
                    <option key={w.orgId || w.settings.orgName} value={w.orgId}>
                      {w.settings.orgName}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="text-[11px] text-slate-500 font-medium">{currentEmployee.name} (@{currentEmployee.username})</div>
          </div>
        </div>

        {/* PIN Badge, My Account & Logout */}
        <div className="flex items-center gap-1.5">
          {/* Employee's 4-Digit Kiosk PIN */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700">
            <span className="text-slate-400">PIN:</span>
            <span className="font-mono font-bold text-slate-900">
              {showPin ? currentEmployee.pinCode : '••••'}
            </span>
            <button
              type="button"
              onClick={() => setShowPin(!showPin)}
              className="text-slate-400 hover:text-slate-600 ml-0.5"
              title="Show/Hide Kiosk PIN"
            >
              {showPin ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </button>
          </div>

          {/* My Account Button */}
          <button
            type="button"
            onClick={() => {
              setAccountUsername(currentEmployee.username);
              setAccountNewPassword('');
              setAccountConfirmPassword('');
              setAccountError(null);
              setAccountFeedback(null);
              setMyAccountOpen(true);
            }}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
            title="My Account Settings"
          >
            <User className="h-3.5 w-3.5 text-slate-500" />
            <span className="hidden sm:inline">Account</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (isClockedIn || isOnBreak) {
                setShowLogoutConfirm(true);
              } else {
                onStaffLogout();
              }
            }}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      {/* Geofence Alert Banner */}
      {showGeofenceExitAlert && (
        <div className="mx-4 mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm text-amber-900 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <h4 className="font-bold text-amber-950 text-sm">You are outside the workplace ({gpsSimMeters}m away)</h4>
            <p className="mt-1 text-amber-800">
              You are currently on the clock. Open Schedule never automatically clocks you out in case you are on an errand. Would you like to clock out now?
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => handlePunch('clock_out')}
                className="rounded-lg bg-rose-600 px-3 py-1.5 font-bold text-white hover:bg-rose-700 shadow-sm"
              >
                Yes, Clock Out
              </button>
              <button
                type="button"
                onClick={() => setGeofenceAlertDismissed(true)}
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-800 hover:bg-amber-100"
              >
                Keep Working
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Tab Views */}
      <main className="flex-1 p-4 max-w-2xl mx-auto w-full">
        {/* TAB 1: Timeclock */}
        {activeTab === 'timeclock' && (
          <div className="space-y-4">
            {/* Status Card */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Current Status
              </span>
              <div className="mt-2 text-2xl font-black text-slate-900">
                {isClockedIn ? (
                  <span className="text-emerald-600 flex items-center justify-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
                    CLOCKED IN
                  </span>
                ) : isOnBreak ? (
                  <span className="text-amber-600 flex items-center justify-center gap-2">
                    <Coffee className="h-5 w-5" />
                    ON BREAK (PAUSED)
                  </span>
                ) : (
                  <span className="text-slate-400">CLOCKED OUT</span>
                )}
              </div>

              {(isClockedIn || isOnBreak) && (
                <div className="mt-4 font-mono text-4xl font-black text-slate-900">
                  {formatSeconds(elapsedSeconds)}
                </div>
              )}

              {/* Action buttons */}
              <div className="mt-6 grid grid-cols-2 gap-3">
                {isClockedOut && (
                  <button
                    type="button"
                    onClick={() => handlePunch('clock_in')}
                    className="col-span-2 flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 text-sm font-bold text-white shadow hover:bg-emerald-700 active:scale-98 transition-all"
                  >
                    <Play className="h-5 w-5" />
                    CLOCK IN TO SHIFT
                  </button>
                )}

                {isClockedIn && (
                  <>
                    <button
                      type="button"
                      onClick={() => handlePunch('break_start')}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-amber-500 py-3 text-xs font-bold text-white hover:bg-amber-600 shadow-sm transition-all"
                    >
                      <Coffee className="h-4 w-4" />
                      TAKE A BREAK
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePunch('clock_out')}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-rose-600 py-3 text-xs font-bold text-white hover:bg-rose-700 shadow-sm transition-all"
                    >
                      <LogOut className="h-4 w-4" />
                      CLOCK OUT
                    </button>
                  </>
                )}

                {isOnBreak && (
                  <button
                    type="button"
                    onClick={() => handlePunch('break_end')}
                    className="col-span-2 flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 text-sm font-bold text-white shadow hover:bg-emerald-700 transition-all"
                  >
                    <Play className="h-5 w-5" />
                    FINISH BREAK & RESUME WORK
                  </button>
                )}
              </div>
            </div>

            {/* Check-In Location / Kiosk Code Status */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Shield className="h-4 w-4 text-emerald-600" />
                  Workplace Presence Check
                </span>
                {isInsideGeofence ? (
                  <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                    GPS Inside Workplace ({gpsSimMeters}m)
                  </span>
                ) : currentEmployee.kioskCodeVerified ? (
                  <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                    Kiosk Code Verified (Session Active)
                  </span>
                ) : (
                  <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                    Outside Workplace ({gpsSimMeters}m)
                  </span>
                )}
              </div>

              {!isInsideGeofence && !currentEmployee.kioskCodeVerified && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-600 mb-2">
                    Enter the live 2-minute check-in code shown on the workplace Kiosk tablet screen:
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      maxLength={6}
                      value={totpInput}
                      onChange={(e) => setTotpInput(e.target.value)}
                      placeholder="e.g. 346739"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-center text-slate-900 tracking-widest focus:border-emerald-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleVerifyTotp}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 shrink-0 shadow-sm"
                    >
                      Verify
                    </button>
                  </div>
                  {totpError && <div className="text-[11px] text-rose-600 font-semibold mt-1.5">{totpError}</div>}
                </div>
              )}
            </div>

            {/* Recent Punches */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                Recent Timecard Punches
              </h3>
              <div className="space-y-2">
                {state.punches
                  .filter((p) => p.employeeId === currentEmployee.id)
                  .slice(-4)
                  .reverse()
                  .map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            p.punchType === 'clock_in'
                              ? 'bg-emerald-500'
                              : p.punchType === 'clock_out'
                              ? 'bg-rose-500'
                              : 'bg-amber-500'
                          }`}
                        />
                        <span className="font-bold capitalize text-slate-800">
                          {p.punchType.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-semibold text-slate-700">
                          {new Date(p.timestampIso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {new Date(p.timestampIso).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: My Shifts */}
        {activeTab === 'myschedule' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">My Upcoming Shifts</h2>
              <button
                type="button"
                onClick={handleExportMyCalendar}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-emerald-700 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Add to Phone Calendar (.ics)
              </button>
            </div>

            <div className="space-y-3">
              {myShifts.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
                  No upcoming shifts assigned yet. Check the Shift Market tab to claim open shifts!
                </div>
              ) : (
                myShifts.map((shift) => {
                  const role = roleMap.get(shift.roleId);
                  const duration = calculateShiftHours(shift.startTime, shift.endTime);
                  return (
                    <div
                      key={shift.id}
                      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                            [{shift.orgName || state.settings.orgName}]
                          </span>
                          <span className="font-bold text-slate-900 text-sm">
                            {shift.date} ({['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][getDayOfWeek(shift.date)]})
                          </span>
                        </div>
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800 font-mono">
                          {duration} hrs
                        </span>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="font-semibold text-emerald-700">
                          {role ? role.name : 'Shift'}
                        </span>
                        <span className="font-mono text-slate-600">
                          {formatShiftRange12H(shift.startTime, shift.endTime)}
                        </span>
                      </div>

                      {shift.notes && (
                        <div className="mt-2 text-xs text-slate-500 italic">
                          "{shift.notes}"
                        </div>
                      )}

                      <div className="mt-3 flex justify-end border-t border-slate-100 pt-2">
                        {shift.isUpForGrabs ? (
                          <span className="text-[11px] font-bold text-amber-700">
                            • Posted Up for Grabs
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onPostShiftUpForGrabs(shift.id)}
                            className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800"
                          >
                            Post Up for Grabs / Trade
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 3: Team Weekly Calendar ("Team" tab) */}
        {activeTab === 'deptschedule' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">Team Weekly Schedule</h2>
                <p className="text-xs text-slate-500">Tap any day to see who is on shift with you.</p>
              </div>

              {/* Prev / Next Week Controls */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const [y, m, d] = teamCalendarWeekStart.split('-').map(Number);
                    const prev = new Date(y, m - 1, d - 7);
                    setTeamCalendarWeekStart(prev.toISOString().slice(0, 10));
                  }}
                  className="rounded-lg border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-100"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs font-bold text-slate-700 font-mono px-1">
                  {teamCalendarWeekStart}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const [y, m, d] = teamCalendarWeekStart.split('-').map(Number);
                    const next = new Date(y, m - 1, d + 7);
                    setTeamCalendarWeekStart(next.toISOString().slice(0, 10));
                  }}
                  className="rounded-lg border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-100"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* 7-Day Calendar Strip */}
            <div className="grid grid-cols-7 gap-1.5">
              {teamWeekDays.map((day) => {
                const dayShifts = state.shifts.filter(
                  (s) => s.date === day.date && s.status === 'published' && s.employeeId
                );
                const isSelected = selectedCalendarDate === day.date;
                return (
                  <button
                    key={day.date}
                    type="button"
                    onClick={() => setSelectedCalendarDate(day.date)}
                    className={`flex flex-col items-center justify-center rounded-xl p-2 text-center transition-all border ${
                      isSelected
                        ? 'border-emerald-600 bg-emerald-50 ring-2 ring-emerald-500/20'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <span className="text-[10px] font-bold text-slate-400 uppercase">
                      {day.dayName.slice(0, 3)}
                    </span>
                    <span className="text-sm font-black text-slate-900 my-0.5">
                      {day.date.slice(8)}
                    </span>
                    <span
                      className={`text-[10px] font-bold rounded-full px-1.5 py-0.2 ${
                        dayShifts.length > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {dayShifts.length} {dayShifts.length === 1 ? 'shift' : 'shifts'}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Expanded List for Selected Day */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm mt-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                Working on {selectedCalendarDate} ({['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][getDayOfWeek(selectedCalendarDate)]})
              </h3>

              {selectedDateShifts.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-2">No team shifts scheduled for this day.</p>
              ) : (
                <div className="space-y-2">
                  {selectedDateShifts.map((shift) => {
                    const emp = state.employees.find((e) => e.id === shift.employeeId);
                    const role = roleMap.get(shift.roleId);
                    const isMe = emp?.id === currentEmployee.id;

                    return (
                      <div
                        key={shift.id}
                        className={`flex items-center justify-between rounded-xl border p-3 text-xs ${
                          isMe
                            ? 'border-emerald-300 bg-emerald-50/60'
                            : 'border-slate-200 bg-slate-50/50'
                        }`}
                      >
                        <div>
                          <div className="font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                            <span className="rounded-md bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[9px] font-bold text-slate-700">
                              [{shift.orgName || state.settings.orgName}]
                            </span>
                            <span>{emp?.name || 'Staff'}</span>
                            {isMe && (
                              <span className="rounded-full bg-emerald-100 text-emerald-800 text-[10px] px-1.5 py-0.2 font-bold">
                                You
                              </span>
                            )}
                          </div>
                          <div className="text-slate-500">{role?.name}</div>
                        </div>
                        <div className="font-mono font-bold text-slate-800">
                          {formatShiftRange12H(shift.startTime, shift.endTime)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: Shift Market */}
        {activeTab === 'upforgrabs' && (
          <div className="space-y-4">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Flame className="h-5 w-5 text-amber-500" />
              Shift Trade & Pickup Market
            </h2>
            <p className="text-xs text-slate-500">
              Claim open shifts or shifts your coworkers have put up for trade.
            </p>

            <div className="space-y-3">
              {upForGrabsShifts.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
                  No shifts are currently up for grabs. Check back later!
                </div>
              ) : (
                upForGrabsShifts.map((shift) => {
                  const role = roleMap.get(shift.roleId);
                  const duration = calculateShiftHours(shift.startTime, shift.endTime);
                  const isQualified =
                    currentEmployee.roleIds.includes(shift.roleId) &&
                    (shift.requiredTags.length === 0 ||
                      shift.requiredTags.every((t) => currentEmployee.tags.includes(t)));

                  return (
                    <div
                      key={shift.id}
                      className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                            [{shift.orgName || state.settings.orgName}]
                          </span>
                          <span className="font-bold text-slate-900 text-sm">{shift.date}</span>
                        </div>
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800 font-mono">
                          {duration} hrs
                        </span>
                      </div>

                      <div className="mt-1 text-xs text-slate-700 font-semibold">
                        {role?.name} • {formatShiftRange12H(shift.startTime, shift.endTime)}
                      </div>

                      {shift.notes && (
                        <div className="mt-2 text-xs italic text-slate-500">
                          "{shift.notes}"
                        </div>
                      )}

                      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
                        {isQualified ? (
                          <span className="text-[11px] text-emerald-700 font-semibold">
                            ✓ You are qualified for this role
                          </span>
                        ) : (
                          <span className="text-[11px] text-rose-600 font-semibold">
                            Missing required skill certification
                          </span>
                        )}

                        <button
                          type="button"
                          disabled={!isQualified}
                          onClick={() => onClaimShift(shift.id, currentEmployee.id)}
                          className="rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed shadow transition-colors"
                        >
                          Claim Shift
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 5: Availability & Time Off */}
        {activeTab === 'availability' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-bold text-slate-900">Weekly Availability Preferences</h2>
              <p className="text-xs text-slate-500 mb-3">
                Let your manager know your regular available days.
              </p>

              <div className="grid grid-cols-2 gap-2">
                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                  (dayName, dayIdx) => {
                    const block = state.availabilities.find(
                      (b) => b.employeeId === currentEmployee.id && b.dayOfWeek === dayIdx
                    );
                    return (
                      <div
                        key={dayIdx}
                        className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm"
                      >
                        <div className="font-bold text-slate-900">{dayName}</div>
                        <div className="mt-1 flex items-center justify-between">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              block?.preference === 'preferred'
                                ? 'bg-emerald-100 text-emerald-800'
                                : block?.preference === 'unavailable'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {block?.preference ? block.preference.toUpperCase() : 'AVAILABLE'}
                          </span>

                          <button
                            type="button"
                            onClick={() => {
                              if (block) {
                                onDeleteAvailability(block.id);
                              } else {
                                onAddAvailability({
                                  id: `av_${Date.now()}_${dayIdx}`,
                                  employeeId: currentEmployee.id,
                                  dayOfWeek: dayIdx,
                                  startTime: '08:00',
                                  endTime: '17:00',
                                  preference: 'unavailable',
                                });
                              }
                            }}
                            className="text-[11px] font-semibold text-emerald-700 hover:underline"
                          >
                            {block ? 'Reset' : 'Mark Unavailable'}
                          </button>
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            </div>

            {/* Time-Off Request */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900 mb-1">Request Time Off</h3>
              <p className="text-xs text-slate-500 mb-3">
                Request vacation, PTO, or half-days. Shifts on approved days will automatically be blocked.
              </p>

              {timeOffSuccessMsg && (
                <div className="mb-3 rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 text-xs font-semibold text-emerald-800">
                  ✓ {timeOffSuccessMsg}
                </div>
              )}

              <form onSubmit={handleSubmitTimeOffForm} className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">Request Type</label>
                    <select
                      value={timeOffType}
                      onChange={(e) => setTimeOffType(e.target.value as any)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="vacation">🌴 Vacation</option>
                      <option value="pto">🏥 Paid Time Off (PTO)</option>
                      <option value="personal">👤 Personal Day</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">Part of Day</label>
                    <select
                      value={timeOffPartOfDay}
                      onChange={(e) => setTimeOffPartOfDay(e.target.value as any)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="full_day">☀️ Full Day Off</option>
                      <option value="morning_half">🌅 Morning Off (After 1 PM OK)</option>
                      <option value="night_half">🌙 Night Off (Before 1 PM OK)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={timeOffStart}
                      onChange={(e) => setTimeOffStart(e.target.value)}
                      required
                      className="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">End Date</label>
                    <input
                      type="date"
                      value={timeOffEnd}
                      onChange={(e) => setTimeOffEnd(e.target.value)}
                      required
                      className="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Reason / Note</label>
                  <input
                    type="text"
                    value={timeOffReason}
                    onChange={(e) => setTimeOffReason(e.target.value)}
                    placeholder="e.g. Family trip, doctor visit, university exam"
                    required
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 shadow-sm transition-colors"
                >
                  Submit Request
                </button>
              </form>

              {/* My Submitted Requests History */}
              {state.timeOffRequests.filter((r) => r.employeeId === currentEmployee.id).length > 0 && (
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <h4 className="text-xs font-bold text-slate-800 mb-2">My Requests</h4>
                  <div className="space-y-1.5">
                    {state.timeOffRequests
                      .filter((r) => r.employeeId === currentEmployee.id)
                      .slice(-3)
                      .reverse()
                      .map((req) => (
                        <div
                          key={req.id}
                          className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5 text-xs"
                        >
                          <div>
                            <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                              <span>
                                {req.startDate === req.endDate
                                  ? req.startDate
                                  : `${req.startDate} to ${req.endDate}`}
                              </span>
                              <span className="text-[10px] text-slate-500 font-normal">
                                ({req.partOfDay === 'morning_half' ? 'Morning Off' : req.partOfDay === 'night_half' ? 'Night Off' : 'Full Day'})
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 truncate max-w-[200px]">
                              {req.reason}
                            </div>
                          </div>
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
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 6: 1-on-1 and Group Chat */}
        {activeTab === 'chat' && (
          <div className="flex flex-col h-[70vh] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {/* Chat Target Selector */}
            <div className="border-b border-slate-200 pb-3 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <MessageSquare className="h-4 w-4 text-emerald-600" />
                  Team Messaging
                </span>
                <span className="text-[11px] text-slate-400">Private & Secure</span>
              </div>

              {/* Chat Recipient Selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-500">Chat with:</span>
                <select
                  value={chatRecipientId || ''}
                  onChange={(e) => setChatRecipientId(e.target.value ? e.target.value : null)}
                  className="rounded-xl border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-800 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="">👥 Team Group Chat (All Staff)</option>
                  {state.employees
                    .filter((e) => e.id !== currentEmployee.id)
                    .map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        👤 {emp.name} (Direct Message)
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* Chat messages */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {filteredMessages.length === 0 ? (
                <div className="text-center py-10 text-xs text-slate-400 italic">
                  No messages in this chat yet. Say hello!
                </div>
              ) : (
                filteredMessages.map((msg) => {
                  const isMe = msg.senderEmployeeId === currentEmployee.id;
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                    >
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mb-0.5">
                        <span>{msg.senderName}</span>
                        <span>•</span>
                        <span>{new Date(msg.timestampIso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                      </div>
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                          isMe
                            ? 'bg-emerald-600 text-white rounded-tr-none'
                            : 'bg-slate-100 text-slate-800 rounded-tl-none'
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Manager-only group chat notice or Input form */}
            {!chatRecipientId && state.settings.groupChatManagerOnly ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <span className="font-bold">📢 Manager Announcements Only:</span> All-team messaging is restricted to managers. Use 1-on-1 direct messages to chat with coworkers.
              </div>
            ) : (
              <form onSubmit={handleSendChat} className="mt-3 flex gap-2 pt-2 border-t border-slate-100">
                <input
                  type="text"
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  placeholder={chatRecipientId ? 'Send direct message...' : 'Message team...'}
                  className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700 transition-colors shadow-sm"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            )}
          </div>
        )}
      </main>

      {/* Bottom Nav Bar */}
      <nav className="sticky bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-slate-200 bg-white/95 py-2 backdrop-blur mt-auto shadow-sm">
        <button
          type="button"
          onClick={() => setActiveTab('timeclock')}
          className={`flex flex-col items-center gap-1 text-[10px] font-semibold transition-colors ${
            activeTab === 'timeclock' ? 'text-emerald-700 font-bold' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <Clock className="h-4 w-4" />
          <span>Timeclock</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('myschedule')}
          className={`flex flex-col items-center gap-1 text-[10px] font-semibold transition-colors ${
            activeTab === 'myschedule' ? 'text-emerald-700 font-bold' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <Calendar className="h-4 w-4" />
          <span>My Shifts</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('deptschedule')}
          className={`flex flex-col items-center gap-1 text-[10px] font-semibold transition-colors ${
            activeTab === 'deptschedule' ? 'text-emerald-700 font-bold' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <Users className="h-4 w-4" />
          <span>Team</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('upforgrabs')}
          className={`flex flex-col items-center gap-1 text-[10px] font-semibold transition-colors ${
            activeTab === 'upforgrabs' ? 'text-emerald-700 font-bold' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <Flame className="h-4 w-4" />
          <span>Market</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('chat')}
          className={`flex flex-col items-center gap-1 text-[10px] font-semibold transition-colors ${
            activeTab === 'chat' ? 'text-emerald-700 font-bold' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          <span>Chat</span>
        </button>
      </nav>

      {/* My Account Modal */}
      {myAccountOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700">
                  <User className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">My Account & Credentials</h3>
                  <p className="text-[11px] text-slate-500">{currentEmployee.name} • {state.settings.orgName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMyAccountOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {accountFeedback && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs font-semibold text-emerald-700">
                {accountFeedback}
              </div>
            )}

            {accountError && (
              <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs font-semibold text-rose-700">
                ✕ {accountError}
              </div>
            )}

            {/* Quick Profile Summary Card */}
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3.5 space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Full Name:</span>
                <span className="font-bold text-slate-900">{currentEmployee.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Assigned Roles:</span>
                <span className="font-semibold text-emerald-700">
                  {currentEmployee.roleIds.map((rId) => roleMap.get(rId)?.name).filter(Boolean).join(', ') || 'Team Member'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Kiosk Check-In PIN:</span>
                <span className="font-mono font-bold text-slate-900 bg-white border border-slate-200 px-2 py-0.5 rounded-md">
                  {currentEmployee.pinCode}
                </span>
              </div>

              {/* Workspace Switcher if employee is part of multiple businesses */}
              {workspaces && Object.keys(workspaces).length > 1 && onSwitchWorkspace && (
                <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between">
                  <span className="text-slate-500 font-medium">Switch Business:</span>
                  <select
                    value={state.orgId || ''}
                    onChange={(e) => {
                      onSwitchWorkspace(e.target.value);
                      setMyAccountOpen(false);
                    }}
                    className="text-xs font-bold text-emerald-800 bg-white rounded-lg border border-slate-200 px-2.5 py-1"
                  >
                    {Object.values(workspaces).map((w) => (
                      <option key={w.orgId || w.settings.orgName} value={w.orgId}>
                        {w.settings.orgName}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Account Settings Form */}
            <form onSubmit={handleSaveAccountChanges} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Username</label>
                <input
                  type="text"
                  value={accountUsername}
                  onChange={(e) => setAccountUsername(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-300 p-2 text-xs font-mono bg-white text-slate-900 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">Used to sign in across web and mobile.</span>
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-2.5">
                <div className="font-semibold text-slate-800">Change Password (Optional)</div>
                <div>
                  <label className="block text-slate-600 mb-1">New Password</label>
                  <input
                    type="password"
                    value={accountNewPassword}
                    onChange={(e) => setAccountNewPassword(e.target.value)}
                    placeholder="Leave blank to keep current"
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs bg-white text-slate-900 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">Confirm New Password</label>
                  <input
                    type="password"
                    value={accountConfirmPassword}
                    onChange={(e) => setAccountConfirmPassword(e.target.value)}
                    placeholder="Re-type new password"
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs bg-white text-slate-900 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setMyAccountOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm transition-colors"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Logout Warning Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center gap-3 text-rose-600 mb-3">
              <AlertTriangle className="h-6 w-6" />
              <h3 className="text-base font-bold text-slate-900">Clock Out & Log Out</h3>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              You are currently on the clock. Logging out will automatically clock you out of your active shift on this device.
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="rounded-xl border border-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Stay Logged In
              </button>
              <button
                type="button"
                onClick={handleConfirmLogout}
                className="rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-rose-700 shadow"
              >
                Clock Out & Log Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Presence Verification Modal */}
      <ConfirmModal
        isOpen={presenceModalOpen}
        title="Check-In Code Required"
        description="Physical presence verification required. You are outside the workplace area. Please enter the live 2-minute code displayed on the Kiosk screen to clock in from your mobile device."
        confirmLabel="Understood"
        cancelLabel="Close"
        onConfirm={() => setPresenceModalOpen(false)}
        onCancel={() => setPresenceModalOpen(false)}
      />
    </div>
  );
};
