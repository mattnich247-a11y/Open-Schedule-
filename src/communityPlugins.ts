/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PluginDefinition } from './types';

export const COMMUNITY_PLUGINS_REGISTRY: PluginDefinition[] = [
  {
    id: 'plugin-slack-alerts',
    name: 'Slack Shift & Schedule Alerts',
    description: 'Automatically broadcasts weekly schedule publications and shift trade alerts to a designated Slack webhook channel.',
    version: '1.0.0',
    author: 'Open Schedule Community',
    category: 'integrations',
    enabled: false,
  },
  {
    id: 'plugin-excel-payroll-bridge',
    name: 'Advanced Excel & QuickBooks Payroll Export',
    description: 'Generates detailed payroll sheets broken down by department tags, employee roles, certification tags, and overtime cost calculations.',
    version: '1.2.0',
    author: 'Open Schedule Core Team',
    category: 'payroll',
    enabled: true,
  },
  {
    id: 'plugin-sms-reminders',
    name: 'SMS Shift Reminders',
    description: 'Sends automated text message reminders to employees 2 hours before their scheduled shift starts.',
    version: '1.0.1',
    author: 'Community Contributor',
    category: 'notifications',
    enabled: false,
  },
];