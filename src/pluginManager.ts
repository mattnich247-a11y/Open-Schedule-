/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Employee,
  OrganizationState,
  PluginDefinition,
  PluginLog,
  Shift,
  TimePunch,
} from './types';
import { calculateShiftHours } from './schedulerEngine';
import { downloadFile } from './calendarAndExport';

export interface PayPeriodApprovalEvent {
  payPeriodStart: string;
  payPeriodEnd: string;
  totalRegularHours: number;
  totalOvertimeHours: number;
  totalEstimatedGrossPay: number;
  employeeSummaries: {
    employeeId: string;
    employeeName: string;
    regularHours: number;
    overtimeHours: number;
    hourlyRate: number;
    grossPay: number;
  }[];
}

export interface SchedulePublishedEvent {
  weekStart: string;
  publishedCount: number;
  totalScheduledHours: number;
  shifts: Shift[];
}

export interface PunchRecordedEvent {
  punch: TimePunch;
  employeeName: string;
  activeStatus: string;
}

export class PluginManager {
  /**
   * Run Universal Payroll CSV Export
   */
  static generatePayrollCsv(event: PayPeriodApprovalEvent): string {
    const headers = [
      'Employee ID',
      'Employee Name',
      'Regular Hours',
      'Overtime Hours',
      'Base Hourly Rate',
      'Gross Pay ($)',
    ];

    const rows = event.employeeSummaries.map((emp) => [
      `"${emp.employeeId}"`,
      `"${emp.employeeName.replace(/"/g, '""')}"`,
      emp.regularHours.toFixed(2),
      emp.overtimeHours.toFixed(2),
      emp.hourlyRate.toFixed(2),
      emp.grossPay.toFixed(2),
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  /**
   * Generate Gusto & ADP Compliant JSON Payload
   */
  static generateGustoAdpPayload(event: PayPeriodApprovalEvent, orgName: string): object {
    return {
      source: 'Open Schedule Plugin Engine',
      version: '2.0-schema',
      company: {
        name: orgName,
        payrollProviderTarget: 'Gusto_ADP_Universal_V2',
      },
      payPeriod: {
        startDate: event.payPeriodStart,
        endDate: event.payPeriodEnd,
        processedAtIso: new Date().toISOString(),
      },
      totals: {
        totalRegularHours: event.totalRegularHours,
        totalOvertimeHours: event.totalOvertimeHours,
        totalGrossSpend: event.totalEstimatedGrossPay,
      },
      employees: event.employeeSummaries.map((emp) => ({
        externalId: emp.employeeId,
        legalName: emp.employeeName,
        earnings: [
          {
            type: 'REGULAR_HOURS',
            hours: emp.regularHours,
            rate: emp.hourlyRate,
            amount: Math.round(emp.regularHours * emp.hourlyRate * 100) / 100,
          },
          ...(emp.overtimeHours > 0
            ? [
                {
                  type: 'OVERTIME_1_5X',
                  hours: emp.overtimeHours,
                  rate: Math.round(emp.hourlyRate * 1.5 * 100) / 100,
                  amount: Math.round(emp.overtimeHours * emp.hourlyRate * 1.5 * 100) / 100,
                },
              ]
            : []),
        ],
        grossPay: emp.grossPay,
      })),
    };
  }

  /**
   * Trigger onPayPeriodApproved Hook
   */
  static onPayPeriodApproved(
    state: OrganizationState,
    event: PayPeriodApprovalEvent
  ): { logs: PluginLog[]; filesGenerated: { name: string; content: string; type: string }[] } {
    const newLogs: PluginLog[] = [];
    const filesGenerated: { name: string; content: string; type: string }[] = [];
    const nowIso = new Date().toISOString();

    const isEnabled = (pluginId: string) =>
      state.plugins.some((p) => p.id === pluginId && p.enabled);

    // 1. Universal Payroll CSV
    if (isEnabled('plugin-payroll-csv')) {
      const csvContent = this.generatePayrollCsv(event);
      const filename = `payroll_${event.payPeriodStart}_to_${event.payPeriodEnd}.csv`;
      filesGenerated.push({ name: filename, content: csvContent, type: 'text/csv' });
      newLogs.push({
        id: `plog_${Date.now()}_csv`,
        timestampIso: nowIso,
        pluginId: 'plugin-payroll-csv',
        level: 'success',
        message: `Generated Payroll CSV for ${event.employeeSummaries.length} employees ($${event.totalEstimatedGrossPay.toFixed(2)} total gross).`,
        payloadSummary: `Rows: ${event.employeeSummaries.length}, Hours: ${(event.totalRegularHours + event.totalOvertimeHours).toFixed(1)}h`,
      });
    }

    // 2. Gusto / ADP JSON
    if (isEnabled('plugin-gusto-adp')) {
      const gustoJson = this.generateGustoAdpPayload(event, state.settings.orgName);
      const jsonContent = JSON.stringify(gustoJson, null, 2);
      const filename = `gusto_adp_payroll_${event.payPeriodStart}.json`;
      filesGenerated.push({ name: filename, content: jsonContent, type: 'application/json' });
      newLogs.push({
        id: `plog_${Date.now()}_gusto`,
        timestampIso: nowIso,
        pluginId: 'plugin-gusto-adp',
        level: 'success',
        message: 'Emitted Gusto/ADP REST payload schema with earning code breakdowns.',
        payloadSummary: JSON.stringify(gustoJson).slice(0, 160) + '...',
      });
    }

    return { logs: newLogs, filesGenerated };
  }

  /**
   * Trigger onSchedulePublished Hook
   */
  static onSchedulePublished(
    state: OrganizationState,
    event: SchedulePublishedEvent
  ): PluginLog[] {
    const newLogs: PluginLog[] = [];
    const nowIso = new Date().toISOString();

    if (state.plugins.some((p) => p.id === 'plugin-shift-webhook' && p.enabled)) {
      newLogs.push({
        id: `plog_${Date.now()}_sched`,
        timestampIso: nowIso,
        pluginId: 'plugin-shift-webhook',
        level: 'info',
        message: `Webhook simulated: Schedule published for week of ${event.weekStart}. Sent notifications to ${event.publishedCount} scheduled shift slots (${event.totalScheduledHours.toFixed(1)} total hours).`,
        payloadSummary: `Target week: ${event.weekStart}, Shifts: ${event.publishedCount}`,
      });
    }

    return newLogs;
  }

  /**
   * Trigger onPunchRecorded Hook
   */
  static onPunchRecorded(
    state: OrganizationState,
    event: PunchRecordedEvent
  ): PluginLog[] {
    const newLogs: PluginLog[] = [];
    const nowIso = new Date().toISOString();

    if (state.plugins.some((p) => p.id === 'plugin-pos-connector' && p.enabled)) {
      newLogs.push({
        id: `plog_${Date.now()}_punch`,
        timestampIso: nowIso,
        pluginId: 'plugin-pos-connector',
        level: 'info',
        message: `Punch event recorded for ${event.employeeName} (${event.punch.punchType} via ${event.punch.verifiedVia.toUpperCase()}). Correlated with live POS sales stream.`,
        payloadSummary: `Punch ID: ${event.punch.id}, Hash: ${event.punch.hash.slice(0, 16)}...`,
      });
    }

    return newLogs;
  }
}
