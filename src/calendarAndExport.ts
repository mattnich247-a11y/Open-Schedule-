/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Employee, OrganizationState, Role, Shift } from './types';
import { decryptVault, encryptVault } from './cryptoEngine';
import { formatShiftRange12H, formatTime12H, getWeekDays } from './schedulerEngine';

/**
 * Format Date to RFC 5545 timestamp: YYYYMMDDTHHMMSS
 */
function formatIcsDateTime(dateStr: string, time24Str: string): string {
  const cleanDate = dateStr.replace(/-/g, '');
  const cleanTime = time24Str.replace(/:/g, '').padEnd(4, '0') + '00';
  return `${cleanDate}T${cleanTime}`;
}

/**
 * Generate RFC 5545 compliant .ics calendar string
 * Uses strict \r\n CRLF endings, deterministic UID, and 60-minute VALARM
 */
export function generateIcsCalendar(
  shifts: Shift[],
  roles: Role[],
  orgName: string,
  calendarTitle = `${orgName} Shifts`
): string {
  const roleMap = new Map(roles.map((r) => [r.id, r]));
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Open Schedule//Workforce Calendar RFC5545//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${calendarTitle}`,
  ];

  for (const shift of shifts) {
    const role = roleMap.get(shift.roleId);
    const roleName = role ? role.name : 'Scheduled Shift';
    const uid = `shift-${shift.id}@openschedule.local`;
    const dtStart = formatIcsDateTime(shift.date, shift.startTime);
    const dtEnd = formatIcsDateTime(shift.date, shift.endTime);
    const summary = `[${orgName}] ${roleName}`;
    const description = `Shift: ${formatShiftRange12H(shift.startTime, shift.endTime)}\\nBusiness: ${orgName}${
      shift.notes ? `\\nNotes: ${shift.notes}` : ''
    }`;

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${formatIcsDateTime(new Date().toISOString().slice(0, 10), '00:00')}Z`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${description}`,
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'TRIGGER:-PT60M',
      'ACTION:DISPLAY',
      `DESCRIPTION:Your shift at ${orgName} starts in 60 minutes`,
      'END:VALARM',
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/**
 * Download a generated text or binary file in the browser
 */
export function downloadFile(filename: string, content: string, contentType = 'text/plain'): void {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generate a standalone, printable black-and-white HTML schedule for breakrooms
 */
export function generatePrintableScheduleHtml(
  shifts: Shift[],
  employees: Employee[],
  roles: Role[],
  weekStart: string,
  orgName: string
): string {
  const weekDays = getWeekDays(weekStart);
  const roleMap = new Map(roles.map((r) => [r.id, r]));

  const rowsHtml = employees
    .map((emp) => {
      const dayCells = weekDays
        .map((day) => {
          const empShifts = shifts.filter(
            (s) => s.employeeId === emp.id && s.date === day.date && s.status === 'published'
          );
          if (empShifts.length === 0) {
            return `<td style="border:1px solid #cbd5e1; padding:8px; text-align:center; color:#94a3b8;">—</td>`;
          }
          const shiftLabels = empShifts
            .map((s) => {
              const role = roleMap.get(s.roleId);
              return `<div style="margin-bottom:4px; font-size:12px;"><strong>${role?.name || 'Shift'}</strong><br/>${formatShiftRange12H(s.startTime, s.endTime)}</div>`;
            })
            .join('');
          return `<td style="border:1px solid #cbd5e1; padding:8px; vertical-align:top;">${shiftLabels}</td>`;
        })
        .join('');

      return `<tr>
        <td style="border:1px solid #cbd5e1; padding:8px; font-weight:bold; background:#f8fafc;">${emp.name}</td>
        ${dayCells}
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${orgName} - Weekly Work Schedule</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 20px; color: #0f172a; }
    h1 { margin: 0 0 4px 0; font-size: 20px; }
    p { margin: 0 0 16px 0; color: #64748b; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { border: 1px solid #cbd5e1; background: #f1f5f9; padding: 8px; text-align: left; }
    @media print {
      body { margin: 0; }
      @page { size: landscape; margin: 1cm; }
    }
  </style>
</head>
<body>
  <h1>${orgName} — Weekly Work Schedule</h1>
  <p>Week of ${weekStart} to ${weekDays[6].date} • Printed on ${new Date().toLocaleDateString()}</p>
  <table>
    <thead>
      <tr>
        <th style="width: 15%;">Team Member</th>
        ${weekDays.map((d) => `<th>${d.dayName}<br/><span style="font-weight:normal; font-size:11px; color:#64748b;">${d.date}</span></th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
  <script>window.onload = function() { window.print(); };</script>
</body>
</html>`;
}

/**
 * Export Encrypted .openschedule Vault Backup
 */
export async function exportEncryptedVault(
  state: OrganizationState,
  passphrase: string
): Promise<void> {
  const rawJson = JSON.stringify(state);
  const encrypted = await encryptVault(rawJson, passphrase);
  const vaultPayload = {
    format: 'openschedule-encrypted-vault',
    version: '1.0',
    exportedAtIso: new Date().toISOString(),
    orgName: state.settings.orgName,
    ...encrypted,
  };

  const filename = `${state.settings.orgName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_backup.openschedule`;
  downloadFile(filename, JSON.stringify(vaultPayload, null, 2), 'application/json');
}

/**
 * Import & Decrypt .openschedule Vault Backup
 */
export async function importOrganizationFile(
  fileOrContent: File | string,
  passphrase?: string
): Promise<OrganizationState> {
  const content = typeof fileOrContent === 'string' ? fileOrContent : await fileOrContent.text();
  return importEncryptedVault(content, passphrase);
}

export async function importEncryptedVault(
  fileContent: string,
  passphrase?: string
): Promise<OrganizationState> {
  let parsed: any;
  try {
    parsed = JSON.parse(fileContent);
  } catch (err: any) {
    throw new Error('Selected file is not valid JSON.');
  }

  // If encrypted format
  if (parsed.format === 'openschedule-encrypted-vault') {
    if (!passphrase) {
      throw new Error('PASSPHRASE_REQUIRED');
    }
    const decryptedJson = await decryptVault(
      parsed.ciphertextHex,
      parsed.ivHex,
      parsed.saltHex,
      passphrase
    );
    const state = JSON.parse(decryptedJson) as OrganizationState;
    return state;
  }

  // If plain unencrypted JSON backup
  if (parsed.settings && Array.isArray(parsed.employees) && Array.isArray(parsed.shifts)) {
    return parsed as OrganizationState;
  }

  throw new Error('Unrecognized file format. Please upload a valid .openschedule or Open Schedule JSON backup.');
}

/**
 * Export Sanitized Read-Only Staff Schedule Share Package (.json)
 * Strips password hashes, salts, kiosk PINs, secret keys, and wage rates
 */
export function exportSanitizedStaffPackage(state: OrganizationState): void {
  const sanitizedEmployees = state.employees.map((emp) => ({
    id: emp.id,
    name: emp.name,
    username: emp.username,
    departmentIds: emp.departmentIds,
    roleIds: emp.roleIds,
    tags: emp.tags,
  }));

  const sanitizedPackage = {
    format: 'openschedule-staff-roster',
    orgName: state.settings.orgName,
    exportedAtIso: new Date().toISOString(),
    operationalHours: state.settings.operationalHours,
    departments: state.departments,
    roles: state.roles,
    skillTags: state.skillTags,
    employees: sanitizedEmployees,
    shifts: state.shifts.filter((s) => s.status === 'published'),
    shiftTemplates: state.shiftTemplates,
    coverageRequirements: state.coverageRequirements,
  };

  const filename = `${state.settings.orgName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_staff_schedule.json`;
  downloadFile(filename, JSON.stringify(sanitizedPackage, null, 2), 'application/json');
}

/**
 * Trigger Breakroom Print View
 */
export function triggerBreakroomPrint(): void {
  window.print();
}
