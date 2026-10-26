/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Check,
  FileSpreadsheet,
  Globe,
  HardDrive,
  Layers,
  Play,
  RotateCw,
  Terminal,
  ToggleLeft,
  ToggleRight,
  X,
} from 'lucide-react';
import { OrganizationState, PluginDefinition } from '../types';
import { PayPeriodApprovalEvent, PluginManager } from '../pluginManager';
import { calculateShiftHours } from '../schedulerEngine';
import { downloadFile } from '../calendarAndExport';

interface PluginModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: OrganizationState;
  onUpdatePlugins: (updated: PluginDefinition[]) => void;
}

export const PluginModal: React.FC<PluginModalProps> = ({
  isOpen,
  onClose,
  state,
  onUpdatePlugins,
}) => {
  const [selectedPluginId, setSelectedPluginId] = useState<string>('plugin-payroll-csv');
  const [activeTab, setActiveTab] = useState<'overview' | 'inspector' | 'logs'>('overview');
  const [testOutput, setTestOutput] = useState<string | null>(null);

  if (!isOpen) return null;

  const plugins = state.plugins;
  const selectedPlugin = plugins.find((p) => p.id === selectedPluginId) || plugins[0];

  const handleToggle = (pluginId: string) => {
    const updated = plugins.map((p) =>
      p.id === pluginId ? { ...p, enabled: !p.enabled } : p
    );
    onUpdatePlugins(updated);
  };

  const handleRunTest = (pluginId: string) => {
    // Build sample event from current roster
    const empSummaries = state.employees.map((emp) => {
      const empShifts = state.shifts.filter((s) => s.employeeId === emp.id && s.status === 'published');
      const totalHrs = empShifts.reduce((acc, s) => acc + calculateShiftHours(s.startTime, s.endTime), 0);
      const regularHours = Math.min(totalHrs, state.settings.weeklyOvertimeHours);
      const overtimeHours = Math.max(0, totalHrs - state.settings.weeklyOvertimeHours);
      const grossPay =
        regularHours * emp.baseHourlyRate + overtimeHours * emp.baseHourlyRate * 1.5;
      return {
        employeeId: emp.id,
        employeeName: emp.name,
        regularHours,
        overtimeHours,
        hourlyRate: emp.baseHourlyRate,
        grossPay,
      };
    });

    const event: PayPeriodApprovalEvent = {
      payPeriodStart: new Date().toISOString().slice(0, 10),
      payPeriodEnd: new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10),
      totalRegularHours: empSummaries.reduce((acc, e) => acc + e.regularHours, 0),
      totalOvertimeHours: empSummaries.reduce((acc, e) => acc + e.overtimeHours, 0),
      totalEstimatedGrossPay: empSummaries.reduce((acc, e) => acc + e.grossPay, 0),
      employeeSummaries: empSummaries,
    };

    if (pluginId === 'plugin-payroll-csv') {
      const csv = PluginManager.generatePayrollCsv(event);
      setTestOutput(csv);
      downloadFile('payroll_preview.csv', csv, 'text/csv');
    } else if (pluginId === 'plugin-gusto-adp') {
      const json = PluginManager.generateGustoAdpPayload(event, state.settings.orgName);
      setTestOutput(JSON.stringify(json, null, 2));
    } else if (pluginId === 'plugin-shift-webhook') {
      const webhookPayload = {
        event: 'schedule.published',
        timestamp: new Date().toISOString(),
        organization: state.settings.orgName,
        totalShiftsPublished: state.shifts.length,
        notificationTargets: state.employees.map((e) => ({
          name: e.name,
          username: e.username,
          shiftsCount: state.shifts.filter((s) => s.employeeId === e.id).length,
        })),
      };
      setTestOutput(JSON.stringify(webhookPayload, null, 2));
    } else {
      const analyticsPayload = {
        event: 'sales_and_reservations_check',
        grossSales: state.salesData.reduce((acc, s) => acc + s.grossSales, 0),
        covers: state.reservationsData.reduce((acc, r) => acc + r.coversExpected, 0),
        activeStaffCount: state.employees.filter((e) => e.currentPunchStatus === 'clocked_in').length,
        summary: 'Connected to live sales and guest counts to guide staffing.',
      };
      setTestOutput(JSON.stringify(analyticsPayload, null, 2));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="flex h-[88vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-100 p-2.5 text-emerald-700">
              <Layers className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Payroll & App Connections</h2>
              <p className="text-xs text-slate-500">
                Connect your timesheets directly with payroll programs, spreadsheets, and POS sales
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="grid flex-1 grid-cols-1 md:grid-cols-3 overflow-hidden">
          {/* Sidebar */}
          <div className="border-r border-slate-200 bg-slate-50/70 p-4 overflow-y-auto">
            <div className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">
              Available Connections ({plugins.length})
            </div>
            <div className="space-y-2">
              {plugins.map((plugin) => (
                <div
                  key={plugin.id}
                  onClick={() => setSelectedPluginId(plugin.id)}
                  className={`cursor-pointer rounded-xl border p-3 transition-all ${
                    selectedPluginId === plugin.id
                      ? 'border-emerald-600 bg-white shadow-sm ring-1 ring-emerald-500/20'
                      : 'border-slate-200 bg-white/70 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-sm text-slate-900">{plugin.name}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggle(plugin.id);
                      }}
                      className="text-slate-400 hover:text-emerald-600"
                    >
                      {plugin.enabled ? (
                        <ToggleRight className="h-6 w-6 text-emerald-600" />
                      ) : (
                        <ToggleLeft className="h-6 w-6 text-slate-400" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 line-clamp-2">{plugin.description}</p>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                    <span>v{plugin.version}</span>
                    <span className="capitalize px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
                      {plugin.category}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Details & Test Run Area */}
          <div className="col-span-2 flex flex-col p-6 overflow-y-auto bg-white">
            {selectedPlugin && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">{selectedPlugin.name}</h3>
                    <p className="text-xs text-slate-500">
                      Provided by: {selectedPlugin.author} • Category: {selectedPlugin.category}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggle(selectedPlugin.id)}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                        selectedPlugin.enabled
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : 'bg-slate-100 text-slate-600 border border-slate-300'
                      }`}
                    >
                      {selectedPlugin.enabled ? 'Active / On' : 'Turned Off'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRunTest(selectedPlugin.id)}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition-colors"
                    >
                      <Play className="h-3.5 w-3.5" />
                      Test Run Connection
                    </button>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-2 border-b border-slate-200 pb-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('overview')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                      activeTab === 'overview'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    How It Works
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('inspector')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                      activeTab === 'inspector'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Preview Output Data
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('logs')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                      activeTab === 'logs'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Recent Activity History ({state.pluginLogs.length})
                  </button>
                </div>

                {/* Content */}
                {activeTab === 'overview' && (
                  <div className="space-y-4 text-xs text-slate-600">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <h4 className="font-bold text-slate-900 mb-1 text-sm">Summary</h4>
                      <p className="leading-relaxed">{selectedPlugin.description}</p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <h4 className="font-bold text-slate-900 mb-2 text-sm">When This Connection Runs</h4>
                      <ul className="space-y-2 list-disc list-inside">
                        <li><strong>When Pay Periods Are Approved:</strong> Generates formatted payroll files ready to upload into payroll systems.</li>
                        <li><strong>When Schedules Are Published:</strong> Sends updates and alerts to staff mobile devices.</li>
                        <li><strong>When Shifts Are Clocked:</strong> Updates daily hours and compares against labor targets.</li>
                      </ul>
                    </div>
                  </div>
                )}

                {activeTab === 'inspector' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Data output generated from your active schedule:</span>
                      <button
                        type="button"
                        onClick={() => handleRunTest(selectedPlugin.id)}
                        className="text-emerald-700 font-semibold hover:underline flex items-center gap-1"
                      >
                        <RotateCw className="h-3 w-3" /> Re-test
                      </button>
                    </div>
                    <pre className="max-h-72 overflow-auto rounded-xl border border-slate-200 bg-slate-900 p-4 font-mono text-xs text-emerald-400">
                      {testOutput ||
                        `// Click "Test Run Connection" above to generate a live preview of this export file or payload.`}
                    </pre>
                  </div>
                )}

                {activeTab === 'logs' && (
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {state.pluginLogs.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">No activity recorded yet.</p>
                    ) : (
                      state.pluginLogs.map((log) => (
                        <div
                          key={log.id}
                          className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"
                        >
                          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                            <span className="font-bold text-emerald-700">[{log.pluginId}]</span>
                            <span>{new Date(log.timestampIso).toLocaleTimeString()}</span>
                          </div>
                          <p className="text-slate-800 font-medium">{log.message}</p>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-slate-200 bg-slate-50 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
