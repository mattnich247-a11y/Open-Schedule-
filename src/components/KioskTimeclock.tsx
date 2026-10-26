/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Coffee,
  KeyRound,
  LogOut,
  Play,
  RotateCcw,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import { Employee, OrganizationState, PunchType, TimePunch } from '../types';
import {
  computePunchHash,
  generateRollingTotp,
  getDeviceId,
  verifyPassword,
  GENESIS_PUNCH_HASH,
} from '../cryptoEngine';

interface KioskTimeclockProps {
  state: OrganizationState;
  onRecordPunch: (punch: TimePunch, updatedEmployee: Employee) => void;
  onExitKiosk: () => void;
  gpsSimMeters?: number;
}

export const KioskTimeclock: React.FC<KioskTimeclockProps> = ({
  state,
  onRecordPunch,
  onExitKiosk,
  gpsSimMeters = 15,
}) => {
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [totpCode, setTotpCode] = useState<string>('------');
  const [remainingSecs, setRemainingSecs] = useState<number>(120);
  const [enteredPin, setEnteredPin] = useState<string>('');
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [recentPunchSuccess, setRecentPunchSuccess] = useState<{
    employeeName: string;
    punchType: PunchType;
    time: string;
  } | null>(null);
  const [exitModalOpen, setExitModalOpen] = useState<boolean>(false);
  const [exitPassword, setExitPassword] = useState<string>('');
  const [exitError, setExitError] = useState<string>('');

  // 120-second (2-minute) timer
  useEffect(() => {
    let isMounted = true;

    const tick = async () => {
      const now = new Date();
      if (!isMounted) return;
      setCurrentTime(now);

      const secret = state.settings.totpSecretHex;
      const digits = state.settings.totpDigits || 6;
      // 120 second time step = 2 minutes
      const totpResult = await generateRollingTotp(secret, digits, 120, now.getTime());
      if (isMounted) {
        setTotpCode(totpResult.code);
        setRemainingSecs(totpResult.remainingSeconds);
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [state.settings.totpSecretHex, state.settings.totpDigits]);

  const handleKeypadPress = (digit: string) => {
    if (enteredPin.length < 6) {
      const next = enteredPin + digit;
      setEnteredPin(next);
      if (next.length === 4) {
        const found = state.employees.find((e) => e.pinCode === next);
        if (found) {
          setSelectedEmployee(found);
        }
      }
    }
  };

  const handleKeypadBackspace = () => {
    const next = enteredPin.slice(0, -1);
    setEnteredPin(next);
    if (next.length < 4) {
      setSelectedEmployee(null);
    }
  };

  const handleClearPin = () => {
    setEnteredPin('');
    setSelectedEmployee(null);
  };

  const handleSelectEmployeeDirect = (emp: Employee) => {
    setSelectedEmployee(emp);
    setEnteredPin(emp.pinCode || '1234');
  };

  const handleExecutePunch = async (punchType: PunchType) => {
    if (!selectedEmployee) return;

    const nowIso = new Date().toISOString();
    const prevHash =
      state.punches.length > 0 ? state.punches[state.punches.length - 1].hash : GENESIS_PUNCH_HASH;

    const shiftId = selectedEmployee.activeShiftId || null;
    const computedHash = await computePunchHash(
      prevHash,
      selectedEmployee.id,
      shiftId,
      punchType,
      nowIso
    );

    const deviceId = getDeviceId();
    const newPunch: TimePunch = {
      id: `punch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      employeeId: selectedEmployee.id,
      shiftId: shiftId,
      punchType,
      timestampIso: nowIso,
      prevHash,
      hash: computedHash,
      latitude: state.settings.geofence.latitude,
      longitude: state.settings.geofence.longitude,
      accuracyMeters: gpsSimMeters,
      verifiedVia: 'pin',
      deviceId,
    };

    let nextStatus: 'clocked_in' | 'on_break' | 'clocked_out' = 'clocked_out';
    let nextPunchStart = selectedEmployee.activePunchStartIso;
    let nextBreakStart = selectedEmployee.activeBreakStartIso;

    if (punchType === 'clock_in') {
      nextStatus = 'clocked_in';
      nextPunchStart = nowIso;
      nextBreakStart = null;
    } else if (punchType === 'break_start') {
      nextStatus = 'on_break';
      nextBreakStart = nowIso;
    } else if (punchType === 'break_end') {
      nextStatus = 'clocked_in';
      nextBreakStart = null;
    } else if (punchType === 'clock_out') {
      nextStatus = 'clocked_out';
      nextPunchStart = null;
      nextBreakStart = null;
    }

    const updatedEmployee: Employee = {
      ...selectedEmployee,
      currentPunchStatus: nextStatus,
      activePunchStartIso: nextPunchStart,
      activeBreakStartIso: nextBreakStart,
      activeSessionDeviceId: nextStatus !== 'clocked_out' ? deviceId : null,
      kioskCodeVerified: nextStatus !== 'clocked_out', // Keep verified for session
    };

    onRecordPunch(newPunch, updatedEmployee);

    setRecentPunchSuccess({
      employeeName: selectedEmployee.name,
      punchType,
      time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    });

    handleClearPin();

    setTimeout(() => {
      setRecentPunchSuccess(null);
    }, 6000);
  };

  const handleManagerExitKiosk = async () => {
    setExitError('');
    // First test against saved manager password hash
    if (state.settings.managerPasswordHash && state.settings.managerSaltHex) {
      const isValid = await verifyPassword(
        exitPassword,
        state.settings.managerPasswordHash,
        state.settings.managerSaltHex
      );
      if (isValid) {
        setExitModalOpen(false);
        onExitKiosk();
        return;
      }
    }

    // Fallback for default demo passwords
    if (exitPassword === 'admin123' || exitPassword === 'demomode' || exitPassword === 'password123') {
      setExitModalOpen(false);
      onExitKiosk();
      return;
    }

    setExitError('Incorrect manager password.');
  };

  const formatRemainingMinutes = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-slate-50 text-slate-800 select-none">
      {/* Top Header */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <Clock className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">{state.settings.orgName}</h1>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Shared Kiosk Timeclock • Ready for Check-In</span>
            </div>
          </div>
        </div>

        {/* Live Clock Display */}
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-2xl font-black text-slate-900">
              {currentTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
            </div>
            <div className="text-xs text-slate-500 font-medium">
              {currentTime.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setExitModalOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            <span>Manager Unlock</span>
          </button>
        </div>
      </header>

      {/* Main Terminal Grid */}
      <main className="grid flex-1 grid-cols-1 lg:grid-cols-12 gap-6 p-6">
        {/* Left: 2-Minute Rotating Check-In Code (5 Cols) */}
        <section className="lg:col-span-5 flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
                <h2 className="text-base font-bold text-slate-900">Check-In Code for Phones</h2>
              </div>
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                2-Minute Code
              </span>
            </div>

            <p className="text-xs text-slate-500 mb-6 leading-relaxed">
              Team members clocking in on their phones can type this live 2-minute code to confirm they are physically inside the workplace.
            </p>

            {/* Rotating 2-Minute TOTP Code Display */}
            <div className="relative flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 py-8 px-4 shadow-sm">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                Current Kiosk Code
              </span>
              <div className="font-mono text-5xl font-black tracking-widest text-emerald-700">
                {totpCode}
              </div>

              {/* Progress countdown bar */}
              <div className="mt-6 w-full max-w-xs">
                <div className="flex justify-between text-xs text-slate-500 font-medium mb-1.5">
                  <span>New code in:</span>
                  <span className="font-bold text-emerald-700">{formatRemainingMinutes(remainingSecs)}</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-emerald-600 transition-all duration-1000 ease-linear rounded-full"
                    style={{ width: `${(remainingSecs / 120) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Quick Staff Tap List */}
          <div className="mt-6">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
              Or Tap Your Name Below:
            </h3>
            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
              {state.employees.map((emp) => (
                <button
                  key={emp.id}
                  type="button"
                  onClick={() => handleSelectEmployeeDirect(emp)}
                  className={`flex flex-col rounded-xl border p-2.5 text-left transition-all ${
                    selectedEmployee?.id === emp.id
                      ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-500/20'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <span className="text-xs font-bold text-slate-900 truncate">{emp.name}</span>
                  <div className="flex items-center justify-between text-[11px] mt-1 text-slate-500">
                    <span>PIN: ••••</span>
                    <span
                      className={`px-1.5 py-0.2 rounded font-semibold ${
                        emp.currentPunchStatus === 'clocked_in'
                          ? 'bg-emerald-100 text-emerald-800'
                          : emp.currentPunchStatus === 'on_break'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {emp.currentPunchStatus === 'clocked_in'
                        ? 'Clocked In'
                        : emp.currentPunchStatus === 'on_break'
                        ? 'On Break'
                        : 'Out'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Right: Keypad & Punch Action Pad (7 Cols) */}
        <section className="lg:col-span-7 flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
              <h2 className="text-base font-bold text-slate-900">
                Staff Check-In Keypad
              </h2>
              {selectedEmployee ? (
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                  Ready: {selectedEmployee.name}
                </span>
              ) : (
                <span className="text-xs text-slate-500">Enter your 4-digit PIN</span>
              )}
            </div>

            {/* Success Alert Banner */}
            {recentPunchSuccess && (
              <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 shadow-sm flex items-start gap-3">
                <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-emerald-900">Time Recorded Successfully!</h4>
                    <span className="text-xs font-bold text-emerald-700">{recentPunchSuccess.time}</span>
                  </div>
                  <p className="text-xs text-emerald-800 mt-0.5">
                    <strong>{recentPunchSuccess.employeeName}</strong> —{' '}
                    <span className="font-bold uppercase">
                      {recentPunchSuccess.punchType.replace('_', ' ')}
                    </span>
                  </p>
                </div>
              </div>
            )}

            {/* PIN Dots */}
            <div className="flex items-center justify-center gap-3 mb-6">
              <div className="flex items-center justify-center w-full max-w-xs rounded-2xl border border-slate-300 bg-slate-50 px-6 py-4 shadow-inner">
                <div className="flex gap-4">
                  {[0, 1, 2, 3].map((idx) => (
                    <div
                      key={idx}
                      className={`h-4 w-4 rounded-full border-2 transition-all ${
                        enteredPin.length > idx
                          ? 'border-emerald-600 bg-emerald-600 scale-110 shadow-sm'
                          : 'border-slate-300 bg-transparent'
                      }`}
                    />
                  ))}
                </div>
              </div>
              {enteredPin.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearPin}
                  className="rounded-xl border border-slate-200 bg-slate-100 p-3 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                >
                  <RotateCcw className="h-5 w-5" />
                </button>
              )}
            </div>

            {/* Number Keypad */}
            <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto mb-6">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleKeypadPress(String(num))}
                  className="flex h-14 items-center justify-center rounded-2xl border border-slate-200 bg-white text-xl font-bold text-slate-800 shadow-sm hover:border-emerald-500 hover:bg-slate-50 active:scale-95 transition-all"
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={handleClearPin}
                className="flex h-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-500 hover:bg-slate-100 transition-all"
              >
                CLEAR
              </button>
              <button
                type="button"
                onClick={() => handleKeypadPress('0')}
                className="flex h-14 items-center justify-center rounded-2xl border border-slate-200 bg-white text-xl font-bold text-slate-800 shadow-sm hover:border-emerald-500 hover:bg-slate-50 active:scale-95 transition-all"
              >
                0
              </button>
              <button
                type="button"
                onClick={handleKeypadBackspace}
                className="flex h-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-500 hover:bg-slate-100 transition-all"
              >
                DELETE
              </button>
            </div>
          </div>

          {/* Action Punch Buttons */}
          <div className="border-t border-slate-200 pt-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <button
                type="button"
                disabled={!selectedEmployee}
                onClick={() => handleExecutePunch('clock_in')}
                className="flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 p-3.5 text-white shadow hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <Play className="h-5 w-5" />
                <span className="text-xs font-bold uppercase tracking-wider">Clock In</span>
              </button>

              <button
                type="button"
                disabled={!selectedEmployee || selectedEmployee.currentPunchStatus !== 'clocked_in'}
                onClick={() => handleExecutePunch('break_start')}
                className="flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-amber-500 p-3.5 text-white shadow hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <Coffee className="h-5 w-5" />
                <span className="text-xs font-bold uppercase tracking-wider">Start Break</span>
              </button>

              <button
                type="button"
                disabled={!selectedEmployee || selectedEmployee.currentPunchStatus !== 'on_break'}
                onClick={() => handleExecutePunch('break_end')}
                className="flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-teal-600 p-3.5 text-white shadow hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <Play className="h-5 w-5" />
                <span className="text-xs font-bold uppercase tracking-wider">End Break</span>
              </button>

              <button
                type="button"
                disabled={!selectedEmployee || selectedEmployee.currentPunchStatus === 'clocked_out'}
                onClick={() => handleExecutePunch('clock_out')}
                className="flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-rose-600 p-3.5 text-white shadow hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <LogOut className="h-5 w-5" />
                <span className="text-xs font-bold uppercase tracking-wider">Clock Out</span>
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Manager Exit Modal */}
      {exitModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-emerald-600" />
                <h3 className="text-base font-bold text-slate-900">Exit Kiosk Mode</h3>
              </div>
              <button
                type="button"
                onClick={() => setExitModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              Enter your Manager Password to unlock and exit this kiosk terminal.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Manager Password
                </label>
                <input
                  type="password"
                  value={exitPassword}
                  onChange={(e) => setExitPassword(e.target.value)}
                  placeholder="Enter manager password..."
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              {exitError && <div className="text-xs text-rose-600 font-semibold">{exitError}</div>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setExitModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleManagerExitKiosk}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow"
                >
                  Unlock & Return to Manager View
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
