/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Compass,
  Download,
  Globe,
  KeyRound,
  Layers,
  Lock,
  LogOut,
  MapPin,
  Plus,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Split,
  Trash2,
  Upload,
  User,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  AppMode,
  AvailabilityBlock,
  CloudSyncConflict,
  CoworkerMessage,
  Department,
  Employee,
  FeatureToggles,
  OrganizationState,
  PluginDefinition,
  Role,
  SkillTag,
  TimeOffRequest,
  TimePunch,
  WorkspacesState,
} from './types';
import {
  DEFAULT_PLUGINS,
  DEMO_PASSWORD_HASH,
  DEMO_PASSWORD_SALT,
  getApexOutfitterPreset,
  getBistro313Preset,
  getBlankPreset,
  getMetroUrgentCarePreset,
  PRESET_OPTIONS,
} from './seedData';
import { hashPassword, verifyPassword } from './cryptoEngine';
import { importOrganizationFile } from './calendarAndExport';
import {
  atomicCloudWrite,
  checkForCloudConflict,
  getIsDirty,
  hydrateFromCloudIfNewer,
  markStateDirty,
  testCloudConnection,
} from './aiAndCloudService';
import { ManagerDashboard } from './components/ManagerDashboard';
import { StaffMobileView } from './components/StaffMobileView';
import { KioskTimeclock } from './components/KioskTimeclock';
import { PluginModal } from './components/PluginModal';

const INACTIVITY_TIMEOUT_SECONDS = 300; // 5 minutes

export default function App() {
  // Multi-workspace container
  const [workspaces, setWorkspaces] = useState<WorkspacesState>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('openschedule_workspaces');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          // fallback
        }
      }
    }
    const bistro = getBistro313Preset();
    const apex = getApexOutfitterPreset();
    return {
      [bistro.orgId || 'org_bistro313']: bistro,
      [apex.orgId || 'org_apex']: apex,
    };
  });

  const [currentOrgId, setCurrentOrgId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const savedId = localStorage.getItem('openschedule_current_org_id');
      if (savedId) return savedId;
    }
    return 'org_bistro313';
  });

  // Current active workspace state
  const [state, setState] = useState<OrganizationState>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('openschedule_state');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          // fallback
        }
      }
    }
    return getBistro313Preset();
  });

  // Network resilience & online/offline listener
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [reconnectedBanner, setReconnectedBanner] = useState<boolean>(false);
  const [syncConflict, setSyncConflict] = useState<CloudSyncConflict | null>(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setReconnectedBanner(true);
      setTimeout(() => setReconnectedBanner(false), 4000);
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 1-minute periodic atomic cloud sync loop (only when dirty & online)
  useEffect(() => {
    const interval = setInterval(async () => {
      if (getIsDirty() && isOnline) {
        try {
          await atomicCloudWrite(state);
          const conflict = await checkForCloudConflict(state);
          if (conflict.hasConflict && conflict.cloudState) {
            setSyncConflict({
              isOpen: true,
              cloudState: conflict.cloudState,
              cloudLastModifiedBy: conflict.cloudLastModifiedBy || 'Another Manager',
              cloudVersionTimestampMs: conflict.cloudVersionTimestampMs || Date.now(),
              localVersionTimestampMs: state.versionTimestampMs || 0,
            });
          }
        } catch (err) {
          console.warn('Periodic atomic sync failed:', err);
        }
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [state, isOnline]);

  // Current session & mode (defaults to logged out)
  const [appMode, setAppMode] = useState<AppMode>('manager');
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [currentEmployee, setCurrentEmployee] = useState<Employee | null>(() => state.employees[0] || null);

  // Demo Sandbox bar controls (defaults to inactive)
  const [isDemoModeActive, setIsDemoModeActive] = useState<boolean>(false);
  const [currentPresetId, setCurrentPresetId] = useState<string>('bistro');
  const [isSplitScreen, setIsSplitScreen] = useState<boolean>(false);
  const [gpsSimMeters, setGpsSimMeters] = useState<number>(18); // 18m = inside building
  const [activeSimulatorEmployeeId, setActiveSimulatorEmployeeId] = useState<string>(
    () => state.employees[1]?.id || state.employees[0]?.id || ''
  );

  // 5-minute auto-lock timer
  const [inactivityRemaining, setInactivityRemaining] = useState<number>(INACTIVITY_TIMEOUT_SECONDS);
  const lastActivityTimeRef = useRef<number>(Date.now());

  // Plugin modal
  const [isPluginModalOpen, setIsPluginModalOpen] = useState<boolean>(false);

  // Login form state (empty defaults, zero jargon)
  const [loginUsername, setLoginUsername] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');
  const [loginModeSelect, setLoginModeSelect] = useState<'manager' | 'staff' | 'kiosk'>('manager');

  // File import for .openschedule backup on login screen
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importPassphrasePrompt, setImportPassphrasePrompt] = useState<boolean>(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [importPassphrase, setImportPassphrase] = useState<string>('');
  const [importError, setImportError] = useState<string>('');

  // Manager Account Setup Wizard State & Draft Resume
  const [savedWizardDraft, setSavedWizardDraft] = useState<any>(() => {
    if (typeof window !== 'undefined') {
      const draft = localStorage.getItem('openschedule_wizard_draft');
      if (draft) {
        try {
          return JSON.parse(draft);
        } catch {
          // fallback
        }
      }
    }
    return null;
  });

  const [isSetupWizardOpen, setIsSetupWizardOpen] = useState<boolean>(false);
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [wizardError, setWizardError] = useState<string>('');
  const [wizardUseAi, setWizardUseAi] = useState<boolean>(false);
  const [wizardTimeclockMode, setWizardTimeclockMode] = useState<'both' | 'kiosk_only' | 'mobile_only'>('both');
  const [wizardTrackLaborCost, setWizardTrackLaborCost] = useState<boolean>(true);

  // In-app Toast Notification State (replaces browser alert popups)
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<any>(null);
  const showToast = (msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 3500);
  };

  // Real-time Coworker Message Toast Notification Tracker
  const lastSeenMessageCountRef = useRef<number>(state.messages.length);
  useEffect(() => {
    if (state.messages.length > lastSeenMessageCountRef.current) {
      const latest = state.messages[state.messages.length - 1];
      if (latest && latest.senderRole !== 'manager') {
        showToast(`💬 New message from ${latest.senderName}: "${latest.text.slice(0, 40)}${latest.text.length > 40 ? '...' : ''}"`);
      }
      lastSeenMessageCountRef.current = state.messages.length;
    }
  }, [state.messages]);

  // Step 2 Wizard details
  const [wizardOrgName, setWizardOrgName] = useState<string>('');
  const [wizardIndustry, setWizardIndustry] = useState<string>('hospitality');
  const [wizardStreetAddress, setWizardStreetAddress] = useState<string>('');
  const [wizardOpenTime, setWizardOpenTime] = useState<string>('08:00');
  const [wizardCloseTime, setWizardCloseTime] = useState<string>('22:00');
  const [wizardBufferHours, setWizardBufferHours] = useState<number>(1);
  const [wizardOvertimeThreshold, setWizardOvertimeThreshold] = useState<number>(40);
  const [wizardManagerName, setWizardManagerName] = useState<string>('');
  const [wizardManagerUsername, setWizardManagerUsername] = useState<string>('manager');
  const [wizardManagerPassword, setWizardManagerPassword] = useState<string>('');

  // Step 3 Wizard: Departments, Roles, Skill tags
  const [wizardDepartments, setWizardDepartments] = useState<string[]>([
    'Kitchen',
    'Front of House',
  ]);
  const [newDeptInput, setNewDeptInput] = useState<string>('');
  const [wizardRoles, setWizardRoles] = useState<string[]>([
    'General Manager',
    'Shift Lead',
    'Team Member',
  ]);
  const [newRoleInput, setNewRoleInput] = useState<string>('');
  const [wizardSkills, setWizardSkills] = useState<string[]>([
    'Keyholder',
    'Opening/Closing',
    'First Aid',
  ]);
  const [newSkillInput, setNewSkillInput] = useState<string>('');

  // Step 4 Wizard: Mandatory Cloud Sync Setup & Testing
  const [wizardCloudSyncEnabled, setWizardCloudSyncEnabled] = useState<boolean>(true);
  const [wizardCloudProvider, setWizardCloudProvider] = useState<'supabase' | 'firebase' | 'local_relay'>('supabase');
  const [wizardCloudProjectUrl, setWizardCloudProjectUrl] = useState<string>('https://relay.openschedule.local');
  const [wizardCloudApiKey, setWizardCloudApiKey] = useState<string>('relay_anon_key_123456');
  const [isCloudTesting, setIsCloudTesting] = useState<boolean>(false);
  const [isCloudTested, setIsCloudTested] = useState<boolean>(false);
  const [cloudTestMessage, setCloudTestMessage] = useState<string>('');

  // Step 5 Wizard: AI Key
  const [wizardAiApiKey, setWizardAiApiKey] = useState<string>('');

  // Auto-save wizard draft whenever fields change
  useEffect(() => {
    if (isSetupWizardOpen) {
      const draft = {
        wizardStep,
        wizardOrgName,
        wizardIndustry,
        wizardStreetAddress,
        wizardOpenTime,
        wizardCloseTime,
        wizardBufferHours,
        wizardOvertimeThreshold,
        wizardManagerName,
        wizardManagerUsername,
        wizardManagerPassword,
        wizardDepartments,
        wizardRoles,
        wizardSkills,
        wizardCloudSyncEnabled,
        wizardCloudProvider,
        wizardCloudProjectUrl,
        wizardCloudApiKey,
        wizardAiApiKey,
        wizardUseAi,
        wizardTimeclockMode,
        wizardTrackLaborCost,
        isCloudTested,
      };
      localStorage.setItem('openschedule_wizard_draft', JSON.stringify(draft));
    }
  }, [
    isSetupWizardOpen,
    wizardStep,
    wizardOrgName,
    wizardIndustry,
    wizardStreetAddress,
    wizardOpenTime,
    wizardCloseTime,
    wizardBufferHours,
    wizardOvertimeThreshold,
    wizardManagerName,
    wizardManagerUsername,
    wizardManagerPassword,
    wizardDepartments,
    wizardRoles,
    wizardSkills,
    wizardCloudSyncEnabled,
    wizardCloudProvider,
    wizardCloudProjectUrl,
    wizardCloudApiKey,
    wizardAiApiKey,
    wizardUseAi,
    wizardTimeclockMode,
    wizardTrackLaborCost,
    isCloudTested,
  ]);

  // Resume unfinished wizard draft
  const handleResumeWizard = () => {
    if (!savedWizardDraft) return;
    setWizardStep(savedWizardDraft.wizardStep || 1);
    setWizardOrgName(savedWizardDraft.wizardOrgName || '');
    setWizardIndustry(savedWizardDraft.wizardIndustry || 'hospitality');
    setWizardStreetAddress(savedWizardDraft.wizardStreetAddress || '');
    setWizardOpenTime(savedWizardDraft.wizardOpenTime || '08:00');
    setWizardCloseTime(savedWizardDraft.wizardCloseTime || '22:00');
    setWizardBufferHours(savedWizardDraft.wizardBufferHours || 1);
    setWizardOvertimeThreshold(savedWizardDraft.wizardOvertimeThreshold || 40);
    setWizardManagerName(savedWizardDraft.wizardManagerName || '');
    setWizardManagerUsername(savedWizardDraft.wizardManagerUsername || 'manager');
    setWizardManagerPassword(savedWizardDraft.wizardManagerPassword || '');
    if (savedWizardDraft.wizardDepartments) setWizardDepartments(savedWizardDraft.wizardDepartments);
    if (savedWizardDraft.wizardRoles) setWizardRoles(savedWizardDraft.wizardRoles);
    if (savedWizardDraft.wizardSkills) setWizardSkills(savedWizardDraft.wizardSkills);
    setWizardCloudSyncEnabled(savedWizardDraft.wizardCloudSyncEnabled ?? true);
    setWizardCloudProvider(savedWizardDraft.wizardCloudProvider || 'supabase');
    setWizardCloudProjectUrl(savedWizardDraft.wizardCloudProjectUrl || 'https://relay.openschedule.local');
    setWizardCloudApiKey(savedWizardDraft.wizardCloudApiKey || 'relay_anon_key_123456');
    setWizardAiApiKey(savedWizardDraft.wizardAiApiKey || '');
    setWizardUseAi(savedWizardDraft.wizardUseAi ?? false);
    setWizardTimeclockMode(savedWizardDraft.wizardTimeclockMode || 'both');
    setWizardTrackLaborCost(savedWizardDraft.wizardTrackLaborCost ?? true);
    setIsCloudTested(savedWizardDraft.isCloudTested ?? false);
    setIsSetupWizardOpen(true);
  };

  const handleDiscardWizard = () => {
    localStorage.removeItem('openschedule_wizard_draft');
    setSavedWizardDraft(null);
    showToast('Unfinished setup draft discarded.');
  };

  // Switch workspace
  const handleSwitchWorkspace = (orgId: string) => {
    const target = workspaces[orgId];
    if (target) {
      setCurrentOrgId(orgId);
      setState(target);
      setCurrentEmployee(target.employees[0] || null);
      showToast(`Switched workspace to ${target.settings.orgName}`);
    }
  };

  // State update wrapper with atomic dirty flag and audit stamping
  const handleUpdateState = (
    newState: OrganizationState,
    actorDetails?: {
      name: string;
      role: 'manager' | 'staff' | 'system';
      action: string;
      details: string;
    }
  ) => {
    const orgId = newState.orgId || currentOrgId || 'org_main';
    markStateDirty(true);

    let updatedStamps = newState.auditStamps || [];
    if (actorDetails) {
      const newStamp = {
        id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        actorName: actorDetails.name,
        actorRole: actorDetails.role,
        action: actorDetails.action,
        details: actorDetails.details,
        timestampIso: new Date().toISOString(),
      };
      updatedStamps = [newStamp, ...updatedStamps].slice(0, 100);
    }

    const stateWithMeta: OrganizationState = {
      ...newState,
      orgId,
      versionTimestampMs: Date.now(),
      lastModifiedBy: actorDetails?.name || state.settings.managerUsername || 'Manager',
      auditStamps: updatedStamps,
    };

    setState(stateWithMeta);
    setWorkspaces((prev) => ({
      ...prev,
      [orgId]: stateWithMeta,
    }));
  };

  // Auto-save active workspace and dictionary to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('openschedule_state', JSON.stringify(state));
      localStorage.setItem('openschedule_workspaces', JSON.stringify(workspaces));
      localStorage.setItem('openschedule_current_org_id', currentOrgId);
    } catch {
      // quota or local storage disabled
    }
  }, [state, workspaces, currentOrgId]);

  // Keep simulator employee synchronized if employees list changes
  useEffect(() => {
    if (state.employees.length > 0) {
      if (!activeSimulatorEmployeeId || !state.employees.find((e) => e.id === activeSimulatorEmployeeId)) {
        setActiveSimulatorEmployeeId(state.employees[0].id);
      }
      if (currentEmployee) {
        const refreshed = state.employees.find((e) => e.id === currentEmployee.id);
        if (refreshed) setCurrentEmployee(refreshed);
      }
    }
  }, [state.employees]);

  // Inactivity auto-lock countdown timer
  useEffect(() => {
    const handleUserActivity = () => {
      lastActivityTimeRef.current = Date.now();
      setInactivityRemaining(INACTIVITY_TIMEOUT_SECONDS);
    };

    window.addEventListener('mousemove', handleUserActivity);
    window.addEventListener('keydown', handleUserActivity);
    window.addEventListener('click', handleUserActivity);
    window.addEventListener('touchstart', handleUserActivity);

    const interval = setInterval(() => {
      // Don't auto-lock if in dedicated Kiosk Mode (kiosk stays unlocked indefinitely)
      if (appMode === 'kiosk') return;

      const elapsed = Math.floor((Date.now() - lastActivityTimeRef.current) / 1000);
      const remaining = Math.max(0, INACTIVITY_TIMEOUT_SECONDS - elapsed);
      setInactivityRemaining(remaining);

      if (remaining === 0 && isLoggedIn) {
        setIsLoggedIn(false);
        setLoginError('Manager vault locked after 5 minutes of inactivity for security.');
      }
    }, 1000);

    return () => {
      window.removeEventListener('mousemove', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
      window.removeEventListener('click', handleUserActivity);
      window.removeEventListener('touchstart', handleUserActivity);
      clearInterval(interval);
    };
  }, [isLoggedIn, appMode]);

  // Hot-swap Industry Presets
  const handleSwitchPreset = (presetId: string) => {
    setCurrentPresetId(presetId);
    let newState: OrganizationState;
    if (presetId === 'bistro') newState = getBistro313Preset();
    else if (presetId === 'apex') newState = getApexOutfitterPreset();
    else if (presetId === 'medical') newState = getMetroUrgentCarePreset();
    else newState = getBlankPreset();

    setState(newState);
    setCurrentEmployee(newState.employees[0] || null);
    if (newState.employees.length > 0) {
      setActiveSimulatorEmployeeId(newState.employees[1]?.id || newState.employees[0].id);
    }
  };

  // Simulate Database Tamper Attack
  const handleSimulateTamperAttack = () => {
    if (state.punches.length === 0) {
      showToast('⚠️ Timecard log is currently empty. Record a punch first in Kiosk or Staff Mode before simulating a tamper test.');
      return;
    }

    const tamperedPunches = [...state.punches];
    const target = tamperedPunches[0];
    const tamperedTime = new Date(new Date(target.timestampIso).getTime() + 7200000).toISOString(); // +2 hours

    tamperedPunches[0] = {
      ...target,
      timestampIso: tamperedTime,
      isTampered: true,
    };

    setState({
      ...state,
      punches: tamperedPunches,
    });

    showToast(
      '⚠️ Test Modification Simulated! Go to "Timecard Security Log" and tap "Scan Timecard Security Log" to see the altered entry detected in red.'
    );
  };

  // Login Authentication Handler
  const handleLoginSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setLoginError('');
  const cleanLoginUser = loginUsername.trim().toLowerCase();

  // 1. Stateless Demo Sandbox Login (Volatile memory only, zero localStorage writes)
  if (cleanLoginUser === 'demo' && loginPassword === 'demomode') {
    setIsDemoModeActive(true);
    setIsLoggedIn(true);
    setAppMode(loginModeSelect);
    if (loginModeSelect === 'staff') {
      setCurrentEmployee(state.employees[0] || null);
    }
    return;
  }

    const cleanUser = loginUsername.trim().toLowerCase();

    // 1. Silent Demo Sandbox Login (if demo / demomode is typed)
    if (cleanUser === 'demo' && loginPassword === 'demomode') {
      setIsDemoModeActive(true);
      setIsLoggedIn(true);
      setAppMode(loginModeSelect);
      if (loginModeSelect === 'staff') {
        setCurrentEmployee(state.employees[0] || null);
      }
      return;
    }

    // 2. Dedicated Kiosk Mode Launch
    if (loginModeSelect === 'kiosk') {
      setIsLoggedIn(true);
      setAppMode('kiosk');
      return;
    }

    // 3. Manager Credentials Verification
    if (loginModeSelect === 'manager' || cleanUser === 'manager') {
      // Check against custom manager password hash if configured
      if (state.settings.managerPasswordHash && state.settings.managerSaltHex) {
        const isValid = await verifyPassword(
          loginPassword,
          state.settings.managerPasswordHash,
          state.settings.managerSaltHex
        );
        if (isValid) {
          setIsLoggedIn(true);
          setAppMode('manager');
          return;
        }
      }

      // Check fallback seeds
      if (loginPassword === 'admin123' || loginPassword === 'demomode' || loginPassword === 'password123') {
        setIsLoggedIn(true);
        setAppMode('manager');
        return;
      }
    }

    // 4. Staff Employee Credentials Verification
    const foundEmp = state.employees.find((e) => e.username.toLowerCase() === cleanLoginUser);
    if (foundEmp) {
      const isValid = await verifyPassword(loginPassword, foundEmp.passwordHash, foundEmp.saltHex);
      if (isValid) {
        setIsLoggedIn(true);
        setAppMode('staff');
        setCurrentEmployee(foundEmp);
        return;
      }
    }

    setLoginError('Invalid username or password. Please check your credentials and try again.');
  };

  // Handle Backup File Import from Login Screen
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');

    try {
      const imported = await importOrganizationFile(file);
      setState(imported);
      setCurrentEmployee(imported.employees[0] || null);
      setIsLoggedIn(true);
      setAppMode('manager');
      showToast(`✓ Successfully restored ${imported.settings.orgName}!`);
    } catch (err: any) {
      if (err.message === 'PASSPHRASE_REQUIRED') {
        setPendingImportFile(file);
        setImportPassphrasePrompt(true);
      } else {
        setImportError(err.message || 'Failed to read backup file.');
      }
    }
  };

  const handleUnlockEncryptedImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingImportFile) return;

    try {
      const imported = await importOrganizationFile(pendingImportFile, importPassphrase);
      setState(imported);
      setCurrentEmployee(imported.employees[0] || null);
      setImportPassphrasePrompt(false);
      setPendingImportFile(null);
      setImportPassphrase('');
      setIsLoggedIn(true);
      setAppMode('manager');
      showToast(`✓ Successfully unlocked and restored ${imported.settings.orgName}!`);
    } catch (err: any) {
      setImportError('Incorrect password for this encrypted backup file.');
    }
  };

  // Complete Multi-Step Setup Wizard
  const handleFinishWizard = async () => {
    setWizardError('');
    if (!wizardOrgName.trim()) {
      setWizardError('Please enter your business name.');
      return;
    }
    if (!wizardManagerPassword.trim()) {
      setWizardError('Please enter a manager password to secure your account.');
      return;
    }

    const { hashHex, saltHex } = await hashPassword(wizardManagerPassword);

    const depts: Department[] = wizardDepartments.map((d, i) => ({
      id: `dept-${Date.now()}-${i}`,
      name: d,
      color: ['#059669', '#2563eb', '#7c3aed', '#d97706'][i % 4],
    }));

    const roles: Role[] = wizardRoles.map((r, i) => ({
      id: `role-${Date.now()}-${i}`,
      name: r,
      departmentId: depts[0]?.id || 'dept-1',
      color: ['#059669', '#2563eb', '#7c3aed', '#d97706'][i % 4],
    }));

    const tags: SkillTag[] = wizardSkills.map((s, i) => ({
      id: `tag-${Date.now()}-${i}`,
      name: s,
      category: 'skill',
      color: '#059669',
    }));

    const managerEmp: Employee = {
      id: `emp-mgr-${Date.now()}`,
      name: wizardManagerName.trim() || 'Business Owner',
      username: wizardManagerUsername.trim().toLowerCase() || 'manager',
      departmentIds: depts.map((d) => d.id),
      roleIds: roles.map((r) => r.id),
      tags: tags.map((t) => t.id),
      targetWeeklyHours: wizardOvertimeThreshold || 40,
      maxWeeklyHours: wizardOvertimeThreshold || 40,
      baseHourlyRate: 35.0,
      requiresPasswordChange: false,
      pinCode: '1234',
      currentPunchStatus: 'clocked_out',
      passwordHash: hashHex,
      saltHex: saltHex,
      kioskCodeVerified: true,
    };

    const newOrgId = `org_${wizardOrgName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'biz'}_${Date.now().toString(36)}`;

    const newOrgState: OrganizationState = {
      orgId: newOrgId,
      versionTimestampMs: Date.now(),
      lastModifiedBy: wizardManagerUsername.trim() || 'Manager',
      settings: {
        orgName: wizardOrgName.trim(),
        industry: wizardIndustry,
        operationalHours: {
          open: wizardOpenTime,
          close: wizardCloseTime,
          bufferBeforeHours: wizardBufferHours,
          bufferAfterHours: wizardBufferHours,
        },
        weeklyOvertimeHours: wizardOvertimeThreshold,
        dailyOvertimeHours: 8,
        earlyClockInGraceMinutes: 60,
        maxBreakMinutes: 45,
        geofence: {
          name: wizardOrgName.trim() || 'Main Workplace',
          latitude: 37.7749,
          longitude: -122.4194,
          radiusMeters: 50,
        },
        swapRequiresManagerApproval: true,
        staffCanPostUpForGrabs: true,
        vacationRequiresApproval: true,
        groupChatManagerOnly: false,
        weeklyBudgetsByWeek: {},
        trackLaborCost: wizardTrackLaborCost,
        laborBudgetWeekly: 5000,
        totpSecretHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        totpDigits: 6,
        managerUsername: wizardManagerUsername.trim().toLowerCase() || 'manager',
        managerPasswordHash: hashHex,
        managerSaltHex: saltHex,
        creatorUsername: wizardManagerUsername.trim().toLowerCase() || 'manager',
        creatorPasswordHash: hashHex,
        creatorSaltHex: saltHex,
        featureToggles: {
          useAi: wizardUseAi,
          timeclockMode: wizardTimeclockMode,
          trackLaborCost: wizardTrackLaborCost,
        },
        cloudSync: {
          enabled: wizardCloudSyncEnabled,
          provider: wizardCloudProvider,
          projectUrl: wizardCloudProjectUrl,
          apiKey: wizardCloudApiKey,
        },
        autoSaveIntervalMinutes: 5,
      },
      departments: depts,
      roles: roles,
      skillTags: tags,
      employees: [managerEmp],
      shifts: [],
      punches: [],
      shiftTemplates: [],
      coverageRequirements: [],
      availabilities: [],
      timeOffRequests: [],
      messages: [],
      plugins: DEFAULT_PLUGINS,
      pluginLogs: [],
      salesData: [],
      reservationsData: [],
      aiConfig: {
        enabled: wizardUseAi,
        provider: 'gemini',
        modelName: 'gemini-2.5-flash',
        apiKeyEncrypted: wizardAiApiKey.trim() || undefined,
      },
      auditStamps: [
        {
          id: `audit_${Date.now()}`,
          actorName: wizardManagerName.trim() || 'Business Owner',
          actorRole: 'manager',
          action: 'WORKSPACE_CREATED',
          details: `Initialized new workspace for ${wizardOrgName.trim()}`,
          timestampIso: new Date().toISOString(),
        },
      ],
    };

    localStorage.removeItem('openschedule_wizard_draft');
    setSavedWizardDraft(null);
    setWorkspaces((prev) => ({
      ...prev,
      [newOrgId]: newOrgState,
    }));
    setCurrentOrgId(newOrgId);
    setState(newOrgState);
    setCurrentEmployee(managerEmp);
    setIsSetupWizardOpen(false);
    setIsLoggedIn(true);
    setAppMode('manager');
  };

  // Punch record handler
  const handleRecordPunch = (punch: TimePunch, updatedEmployee: Employee) => {
    const updatedEmployees = state.employees.map((e) =>
      e.id === updatedEmployee.id ? updatedEmployee : e
    );

    handleUpdateState(
      {
        ...state,
        employees: updatedEmployees,
        punches: [...state.punches, punch],
      },
      {
        name: updatedEmployee.name,
        role: 'staff',
        action: punch.punchType.toUpperCase(),
        details: `${updatedEmployee.name} recorded ${punch.punchType.replace('_', ' ')} via ${punch.verifiedVia.toUpperCase()}`,
      }
    );

    if (currentEmployee?.id === updatedEmployee.id) {
      setCurrentEmployee(updatedEmployee);
    }
  };

  // Staff action handlers
  const handleClaimShift = (shiftId: string, employeeId: string) => {
    const emp = state.employees.find((e) => e.id === employeeId);
    const updated = state.shifts.map((s) =>
      s.id === shiftId
        ? {
            ...s,
            employeeId,
            isUpForGrabs: false,
            status: 'published' as const,
          }
        : s
    );
    handleUpdateState(
      { ...state, shifts: updated },
      {
        name: emp?.name || 'Staff',
        role: 'staff',
        action: 'SHIFT_CLAIMED',
        details: `${emp?.name || 'Staff'} claimed shift on ${updated.find((s) => s.id === shiftId)?.date}`,
      }
    );
    showToast('✓ Shift claimed! It has been added to your personal schedule.');
  };

  const handlePostShiftUpForGrabs = (shiftId: string) => {
    const targetShift = state.shifts.find((s) => s.id === shiftId);
    const updated = state.shifts.map((s) =>
      s.id === shiftId
        ? {
            ...s,
            isUpForGrabs: true,
          }
        : s
    );
    handleUpdateState(
      { ...state, shifts: updated },
      {
        name: currentEmployee?.name || 'Staff',
        role: 'staff',
        action: 'SHIFT_UP_FOR_GRABS',
        details: `Posted shift on ${targetShift?.date || 'shift'} up for grabs`,
      }
    );
    showToast('✓ Shift posted up for grabs! Qualified coworkers can now view and claim it.');
  };

  const handleAddAvailability = (block: AvailabilityBlock) => {
    handleUpdateState({
      ...state,
      availabilities: [...state.availabilities, block],
    });
  };

  const handleDeleteAvailability = (blockId: string) => {
    handleUpdateState({
      ...state,
      availabilities: state.availabilities.filter((b) => b.id !== blockId),
    });
  };

  const handleSubmitTimeOff = (request: TimeOffRequest) => {
    handleUpdateState({
      ...state,
      timeOffRequests: [...state.timeOffRequests, request],
    });
  };

  const handleSendMessage = (msg: CoworkerMessage) => {
    handleUpdateState({
      ...state,
      messages: [...state.messages, msg],
    });
  };

  const simulatorEmployee =
    state.employees.find((e) => e.id === activeSimulatorEmployeeId) || state.employees[0];

  // Feature toggle checks
  const timeclockMode = state.settings.featureToggles?.timeclockMode || 'both';
  const isKioskAllowed = timeclockMode === 'both' || timeclockMode === 'kiosk_only';
  const isMobileAllowed = timeclockMode === 'both' || timeclockMode === 'mobile_only';

  // ==========================================
  // AUTHENTICATION GATE SCREEN (LOGGED OUT)
  // ==========================================
  if (!isLoggedIn) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4 text-slate-800">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelected}
          accept=".openschedule,.json"
          className="hidden"
        />

        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
          {/* Logo & Header */}
          <div className="flex items-center gap-3 border-b border-slate-100 pb-5 mb-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <Building2 className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">Open Schedule</h1>
              <p className="text-xs text-slate-500 font-medium">Workforce Scheduling & Secure Timeclock</p>
            </div>
          </div>

          {/* Warm Resume Setup Banner */}
          {savedWizardDraft && (
            <div className="mb-5 rounded-2xl border border-emerald-300 bg-emerald-50/80 p-4 text-xs shadow-xs animate-in fade-in">
              <div className="flex items-center gap-2 font-bold text-slate-900 mb-1">
                <Sparkles className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>Unfinished Business Setup Detected</span>
              </div>
              <p className="text-slate-600 mb-3 text-[11px] leading-relaxed">
                You have a saved setup draft for <strong>{savedWizardDraft.wizardOrgName || 'My Business'}</strong> (Step {savedWizardDraft.wizardStep || 1} of 5).
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleResumeWizard}
                  className="rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition"
                >
                  Resume Setup
                </button>
                <button
                  type="button"
                  onClick={handleDiscardWizard}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
                >
                  Start Over
                </button>
              </div>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleLoginSubmit} className="space-y-4 text-xs">
            {/* Mode selection buttons */}
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setLoginModeSelect('manager')}
                className={`py-2 rounded-lg font-bold text-xs transition-all ${
                  loginModeSelect === 'manager'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Manager
              </button>
              <button
                type="button"
                onClick={() => setLoginModeSelect('staff')}
                className={`py-2 rounded-lg font-bold text-xs transition-all ${
                  loginModeSelect === 'staff'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Employee View
              </button>
              <button
                type="button"
                onClick={() => setLoginModeSelect('kiosk')}
                className={`py-2 rounded-lg font-bold text-xs transition-all ${
                  loginModeSelect === 'kiosk'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Kiosk Terminal
              </button>
            </div>

            {loginModeSelect !== 'kiosk' ? (
              <>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1 text-xs">Username</label>
                  <input
                    type="text"
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    placeholder="Enter your username"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1 text-xs">Password</label>
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 focus:outline-none"
                    required
                  />
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                <p className="font-semibold mb-1">Dedicated Kiosk Timeclock</p>
                <p className="text-slate-600 text-[11px]">
                  Launches full-screen timeclock for in-person clock ins with 4-digit PINs.
                </p>
              </div>
            )}

            {loginError && (
              <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700">
                {loginError}
              </div>
            )}

            {importError && (
              <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700">
                {importError}
              </div>
            )}

            <button
              type="submit"
              className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white shadow hover:bg-emerald-700 transition-colors cursor-pointer"
            >
              {loginModeSelect === 'kiosk'
                ? `Launch Kiosk for ${state.settings.orgName}`
                : `Sign In to ${state.settings.orgName}`}
            </button>
          </form>

          {/* Quick Actions & Wizard on Login Screen */}
          <div className="mt-6 pt-5 border-t border-slate-200 space-y-2.5">
            <button
              type="button"
              onClick={() => {
                setWizardStep(1);
                setIsSetupWizardOpen(true);
              }}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50/70 hover:bg-emerald-100 py-2.5 text-xs font-bold text-emerald-800 transition-colors"
            >
              <Plus className="h-4 w-4 text-emerald-600" />
              <span>Create Manager Account / Set Up New Business</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 py-2.5 text-xs font-semibold text-slate-700 transition-colors"
            >
              <Upload className="h-4 w-4 text-slate-500" />
              <span>Import .openschedule Backup File</span>
            </button>

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => {
                  setLoginUsername('demo');
                  setLoginPassword('demomode');
                  setIsDemoModeActive(true);
                  setIsLoggedIn(true);
                  setAppMode('manager');
                }}
                className="text-[11px] font-medium text-slate-400 hover:text-emerald-700 transition-colors inline-flex items-center gap-1"
              >
                <Sparkles className="h-3 w-3" />
                <span>Explore Sample Business (Demo Sandbox)</span>
              </button>
            </div>
          </div>
        </div>

        {/* Encrypted File Passphrase Modal */}
        {importPassphrasePrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
            <div className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 p-6 shadow-2xl">
              <div className="flex items-center gap-2 text-emerald-700 mb-3">
                <Lock className="h-5 w-5" />
                <h3 className="font-bold text-slate-900">Encrypted Backup</h3>
              </div>
              <p className="text-xs text-slate-600 mb-4">
                This backup was encrypted with a master password. Please enter the password to unlock it:
              </p>
              <form onSubmit={handleUnlockEncryptedImport} className="space-y-3">
                <input
                  type="password"
                  value={importPassphrase}
                  onChange={(e) => setImportPassphrase(e.target.value)}
                  placeholder="Master Passphrase"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs focus:outline-none focus:border-emerald-600"
                  required
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setImportPassphrasePrompt(false);
                      setPendingImportFile(null);
                    }}
                    className="flex-1 rounded-xl border border-slate-300 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 rounded-xl bg-emerald-600 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                  >
                    Unlock & Import
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 5-Step Account Setup Wizard Modal */}
        {isSetupWizardOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs overflow-y-auto">
            <div className="w-full max-w-2xl rounded-3xl bg-white border border-slate-200 shadow-2xl p-6 md:p-8 my-8 text-slate-800">
              {/* Wizard Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Set Up Your Business</h2>
                  <p className="text-xs text-slate-500">Step {wizardStep} of 5</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSetupWizardOpen(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Progress dots */}
              <div className="flex items-center justify-between mb-6 px-4">
                {[1, 2, 3, 4, 5].map((s) => (
                  <div key={s} className="flex items-center gap-2">
                    <div
                      className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold ${
                        wizardStep === s
                          ? 'bg-emerald-600 text-white'
                          : wizardStep > s
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {wizardStep > s ? <Check className="h-4 w-4" /> : s}
                    </div>
                    {s < 5 && (
                      <div
                        className={`h-0.5 w-8 md:w-16 ${
                          wizardStep > s ? 'bg-emerald-500' : 'bg-slate-200'
                        }`}
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* STEP 1: Choose Your Features */}
              {wizardStep === 1 && (
                <div className="space-y-5">
                  <div className="border-b border-slate-100 pb-2">
                    <h3 className="font-bold text-slate-900 text-sm">Step 1: Choose Your Features</h3>
                    <p className="text-xs text-slate-500">
                      Select which capabilities you want active right now. You can change these anytime in Settings.
                    </p>
                  </div>

                  <div className="space-y-3">
                    {/* Feature 1: AI */}
                    <div className="flex items-start justify-between rounded-2xl border border-slate-200 p-4 hover:border-slate-300">
                      <div>
                        <p className="font-bold text-xs text-slate-900">AI Scheduling & Forecast Insights</p>
                        <p className="text-[11px] text-slate-500">
                          Automate multi-day shift creation and analyze sales records with an optional AI key.
                        </p>
                      </div>
                      <div className="flex gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                        <button
                          type="button"
                          onClick={() => setWizardUseAi(true)}
                          className={`px-3 py-1 text-xs font-bold rounded ${
                            wizardUseAi ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600'
                          }`}
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setWizardUseAi(false)}
                          className={`px-3 py-1 text-xs font-bold rounded ${
                            !wizardUseAi ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-600'
                          }`}
                        >
                          No
                        </button>
                      </div>
                    </div>

                    {/* Feature 2: Timeclock Mode */}
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <p className="font-bold text-xs text-slate-900 mb-1">Timeclock Mode</p>
                      <p className="text-[11px] text-slate-500 mb-3">
                        Choose how your team clocks in and out.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => setWizardTimeclockMode('both')}
                          className={`p-3 rounded-xl border text-left text-xs transition-all ${
                            wizardTimeclockMode === 'both'
                              ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-bold ring-1 ring-emerald-600'
                              : 'border-slate-200 hover:border-slate-300 text-slate-700'
                          }`}
                        >
                          <div className="font-bold mb-0.5">Mobile + Kiosk</div>
                          <div className="text-[10px] text-slate-500">Phone GPS & Tablet PIN pad</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setWizardTimeclockMode('kiosk_only')}
                          className={`p-3 rounded-xl border text-left text-xs transition-all ${
                            wizardTimeclockMode === 'kiosk_only'
                              ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-bold ring-1 ring-emerald-600'
                              : 'border-slate-200 hover:border-slate-300 text-slate-700'
                          }`}
                        >
                          <div className="font-bold mb-0.5">Kiosk Only</div>
                          <div className="text-[10px] text-slate-500">Shared tablet by entrance</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setWizardTimeclockMode('mobile_only')}
                          className={`p-3 rounded-xl border text-left text-xs transition-all ${
                            wizardTimeclockMode === 'mobile_only'
                              ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-bold ring-1 ring-emerald-600'
                              : 'border-slate-200 hover:border-slate-300 text-slate-700'
                          }`}
                        >
                          <div className="font-bold mb-0.5">Mobile Only</div>
                          <div className="text-[10px] text-slate-500">Employee smartphones</div>
                        </button>
                      </div>
                    </div>

                    {/* Feature 3: Labor Budget */}
                    <div className="flex items-start justify-between rounded-2xl border border-slate-200 p-4 hover:border-slate-300">
                      <div>
                        <p className="font-bold text-xs text-slate-900">Track Hourly Pay & Labor Budget</p>
                        <p className="text-[11px] text-slate-500">
                          Show estimated labor costs, overtime hours, and payroll wage totals.
                        </p>
                      </div>
                      <div className="flex gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                        <button
                          type="button"
                          onClick={() => setWizardTrackLaborCost(true)}
                          className={`px-3 py-1 text-xs font-bold rounded ${
                            wizardTrackLaborCost ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600'
                          }`}
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setWizardTrackLaborCost(false)}
                          className={`px-3 py-1 text-xs font-bold rounded ${
                            !wizardTrackLaborCost ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-600'
                          }`}
                        >
                          No
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: Business & Manager Details */}
              {wizardStep === 2 && (
                <div className="space-y-4">
                  <div className="border-b border-slate-100 pb-2">
                    <h3 className="font-bold text-slate-900 text-sm">Step 2: Business & Manager Information</h3>
                    <p className="text-xs text-slate-500">
                      Basic details to personalize your workspace and create your administrator credentials.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Business Name *</label>
                      <input
                        type="text"
                        value={wizardOrgName}
                        onChange={(e) => setWizardOrgName(e.target.value)}
                        placeholder="e.g. Sunrise Cafe, Apex Retail"
                        className="w-full rounded-xl border border-slate-300 p-2.5 text-xs text-slate-900 focus:outline-none focus:border-emerald-600"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Industry</label>
                      <select
                        value={wizardIndustry}
                        onChange={(e) => setWizardIndustry(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 p-2.5 text-xs text-slate-900 focus:outline-none"
                      >
                        <option value="hospitality">Hospitality / Food & Beverage</option>
                        <option value="retail">Retail / Commerce</option>
                        <option value="healthcare">Healthcare / Medical</option>
                        <option value="office">Office / Professional Services</option>
                        <option value="custom">Other / Custom</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Open Time</label>
                      <input
                        type="time"
                        value={wizardOpenTime}
                        onChange={(e) => setWizardOpenTime(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 p-2 text-xs text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Close Time</label>
                      <input
                        type="time"
                        value={wizardCloseTime}
                        onChange={(e) => setWizardCloseTime(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 p-2 text-xs text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Shift Buffer (Hrs)</label>
                      <input
                        type="number"
                        min="0"
                        max="8"
                        value={wizardBufferHours}
                        onChange={(e) => setWizardBufferHours(Number(e.target.value))}
                        className="w-full rounded-xl border border-slate-300 p-2 text-xs text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Overtime Limit (Hrs)</label>
                      <input
                        type="number"
                        min="20"
                        max="80"
                        value={wizardOvertimeThreshold}
                        onChange={(e) => setWizardOvertimeThreshold(Number(e.target.value))}
                        className="w-full rounded-xl border border-slate-300 p-2 text-xs text-slate-900"
                      />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100">
                    <p className="text-xs font-bold text-slate-900 mb-2">Manager Account Setup</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">Manager Full Name</label>
                        <input
                          type="text"
                          value={wizardManagerName}
                          onChange={(e) => setWizardManagerName(e.target.value)}
                          placeholder="e.g. Alex Morgan"
                          className="w-full rounded-xl border border-slate-300 p-2.5 text-xs text-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">Username *</label>
                        <input
                          type="text"
                          value={wizardManagerUsername}
                          onChange={(e) => setWizardManagerUsername(e.target.value)}
                          placeholder="manager"
                          className="w-full rounded-xl border border-slate-300 p-2.5 text-xs text-slate-900"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">Manager Password *</label>
                        <input
                          type="password"
                          value={wizardManagerPassword}
                          onChange={(e) => setWizardManagerPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full rounded-xl border border-slate-300 p-2.5 text-xs text-slate-900"
                          required
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: Initial Departments, Roles & Skills */}
              {wizardStep === 3 && (
                <div className="space-y-4">
                  <div className="border-b border-slate-100 pb-2">
                    <h3 className="font-bold text-slate-900 text-sm">Step 3: Departments, Roles & Skills</h3>
                    <p className="text-xs text-slate-500">
                      Configure your team structure. You can customize, add, or delete any of these.
                    </p>
                  </div>

                  {/* Departments */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Departments</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {wizardDepartments.map((d, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 bg-slate-100 text-slate-800 text-xs px-2.5 py-1 rounded-lg border border-slate-200"
                        >
                          {d}
                          <button
                            type="button"
                            onClick={() => setWizardDepartments(wizardDepartments.filter((_, i) => i !== idx))}
                            className="text-slate-400 hover:text-rose-600"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newDeptInput}
                        onChange={(e) => setNewDeptInput(e.target.value)}
                        placeholder="Add department (e.g. Sales, Service)"
                        className="flex-1 rounded-xl border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (newDeptInput.trim()) {
                            setWizardDepartments([...wizardDepartments, newDeptInput.trim()]);
                            setNewDeptInput('');
                          }
                        }}
                        className="rounded-xl bg-slate-100 hover:bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Roles */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Job Roles</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {wizardRoles.map((r, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-800 text-xs px-2.5 py-1 rounded-lg border border-emerald-200"
                        >
                          {r}
                          <button
                            type="button"
                            onClick={() => setWizardRoles(wizardRoles.filter((_, i) => i !== idx))}
                            className="text-emerald-500 hover:text-rose-600"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newRoleInput}
                        onChange={(e) => setNewRoleInput(e.target.value)}
                        placeholder="Add role (e.g. Cashier, Server, Associate)"
                        className="flex-1 rounded-xl border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (newRoleInput.trim()) {
                            setWizardRoles([...wizardRoles, newRoleInput.trim()]);
                            setNewRoleInput('');
                          }
                        }}
                        className="rounded-xl bg-slate-100 hover:bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Skill tags */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Skill & Shift Tags</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {wizardSkills.map((s, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 text-xs px-2.5 py-1 rounded-lg border border-amber-200"
                        >
                          {s}
                          <button
                            type="button"
                            onClick={() => setWizardSkills(wizardSkills.filter((_, i) => i !== idx))}
                            className="text-amber-500 hover:text-rose-600"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newSkillInput}
                        onChange={(e) => setNewSkillInput(e.target.value)}
                        placeholder="Add tag (e.g. Bilingual, Keyholder, Barista)"
                        className="flex-1 rounded-xl border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (newSkillInput.trim()) {
                            setWizardSkills([...wizardSkills, newSkillInput.trim()]);
                            setNewSkillInput('');
                          }
                        }}
                        className="rounded-xl bg-slate-100 hover:bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 4: Cloud Sync Setup (Mandatory) */}
              {wizardStep === 4 && (
                <div className="space-y-4">
                  <div className="border-b border-slate-100 pb-2">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-slate-900 text-sm">Step 4: Cloud Sync Setup (Mandatory)</h3>
                      <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 uppercase">
                        Required
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Connect your Supabase or Firebase project (or use the built-in Local Relay). Connection must be tested and verified before proceeding.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Sync Provider</label>
                      <select
                        value={wizardCloudProvider}
                        onChange={(e) => {
                          setWizardCloudProvider(e.target.value as any);
                          setIsCloudTested(false);
                          setCloudTestMessage('');
                        }}
                        className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs text-slate-900 font-medium"
                      >
                        <option value="supabase">Supabase (PostgreSQL / Realtime)</option>
                        <option value="firebase">Firebase Firestore</option>
                        <option value="local_relay">Local Relay Sandbox (Pre-configured)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Project URL / API Endpoint</label>
                      <input
                        type="text"
                        value={wizardCloudProjectUrl}
                        onChange={(e) => {
                          setWizardCloudProjectUrl(e.target.value);
                          setIsCloudTested(false);
                          setCloudTestMessage('');
                        }}
                        placeholder={
                          wizardCloudProvider === 'supabase'
                            ? 'https://your-project.supabase.co'
                            : wizardCloudProvider === 'firebase'
                            ? 'https://firestore.googleapis.com/v1/projects/your-project'
                            : 'https://relay.openschedule.local'
                        }
                        className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs text-slate-900 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">API Key / Anon Public Key</label>
                      <input
                        type="password"
                        value={wizardCloudApiKey}
                        onChange={(e) => {
                          setWizardCloudApiKey(e.target.value);
                          setIsCloudTested(false);
                          setCloudTestMessage('');
                        }}
                        placeholder="eyJhbGciOi..."
                        className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs text-slate-900 font-mono"
                      />
                    </div>

                    <div className="pt-1 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        disabled={isCloudTesting}
                        onClick={async () => {
                          setIsCloudTesting(true);
                          setWizardError('');
                          const res = await testCloudConnection(wizardCloudProvider, wizardCloudProjectUrl, wizardCloudApiKey);
                          setIsCloudTesting(false);
                          if (res.success) {
                            setIsCloudTested(true);
                            setCloudTestMessage(res.message);
                          } else {
                            setIsCloudTested(false);
                            setWizardError(res.message);
                          }
                        }}
                        className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold shadow-xs transition ${
                          isCloudTested
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-900 hover:bg-slate-800 text-white'
                        }`}
                      >
                        {isCloudTesting ? (
                          <>
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            <span>Verifying...</span>
                          </>
                        ) : isCloudTested ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>✓ Connection Verified!</span>
                          </>
                        ) : (
                          <>
                            <Globe className="h-3.5 w-3.5" />
                            <span>Test Cloud Connection</span>
                          </>
                        )}
                      </button>

                      {isCloudTested && (
                        <span className="text-[11px] font-semibold text-emerald-700">
                          Ready for Step 5
                        </span>
                      )}
                    </div>

                    {cloudTestMessage && (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-[11px] font-medium text-emerald-800">
                        {cloudTestMessage}
                      </div>
                    )}

                    <div className="rounded-xl bg-white border border-slate-200 p-2.5 text-[11px] text-slate-600">
                      🔒 <strong>Privacy Guard:</strong> All employee PINs, password hashes, wage rates, and phone numbers are automatically stripped before sending data to any cloud database.
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 5: Optional AI API Key */}
              {wizardStep === 5 && (
                <div className="space-y-4">
                  <div className="border-b border-slate-100 pb-2">
                    <h3 className="font-bold text-slate-900 text-sm">Step 5: AI Operations Setup (Optional)</h3>
                    <p className="text-xs text-slate-500">
                      Configure your own API key for smart schedule generation. Zero data is sent to AI without a key.
                    </p>
                  </div>

                  {wizardUseAi ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Gemini API Key (BYOK)
                        </label>
                        <input
                          type="password"
                          value={wizardAiApiKey}
                          onChange={(e) => setWizardAiApiKey(e.target.value)}
                          placeholder="AIzaSy..."
                          className="w-full rounded-xl border border-slate-300 p-2.5 text-xs text-slate-900 font-mono"
                        />
                        <p className="text-[11px] text-slate-500 mt-1">
                          Stored locally in your browser. Leave blank if you wish to use rule-based auto-fill without AI.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                      <p className="font-semibold text-slate-900 mb-1">AI Features Disabled</p>
                      <p>
                        You chose not to use AI in Step 1. Your schedules will be generated using deterministic rule-based allocation (fair hours, role qualifications, and availability). You can turn on AI anytime in Settings.
                      </p>
                    </div>
                  )}

                  {/* Summary of Configuration */}
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs space-y-1.5">
                    <p className="font-bold text-slate-900 mb-2">Setup Summary:</p>
                    <div className="flex justify-between text-slate-600">
                      <span>Business:</span>
                      <strong className="text-slate-900">{wizardOrgName || 'My Business'}</strong>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Timeclock Mode:</span>
                      <strong className="text-slate-900 capitalize">{wizardTimeclockMode.replace('_', ' ')}</strong>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Departments:</span>
                      <strong className="text-slate-900">{wizardDepartments.length} configured</strong>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Cloud Sync:</span>
                      <strong className="text-slate-900">{wizardCloudSyncEnabled ? 'Enabled' : 'Disabled'}</strong>
                    </div>
                  </div>
                </div>
              )}

              {/* Wizard Footer Navigation */}
              <div className="mt-8 pt-4 border-t border-slate-100 flex items-center justify-between">
                {wizardStep > 1 ? (
                  <button
                    type="button"
                    onClick={() => setWizardStep(wizardStep - 1)}
                    className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Back
                  </button>
                ) : (
                  <div />
                )}

                {wizardError && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">
                    {wizardError}
                  </div>
                )}

                {wizardStep < 5 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setWizardError('');
                      if (wizardStep === 2 && !wizardOrgName.trim()) {
                        setWizardError('Please enter your business name.');
                        return;
                      }
                      if (wizardStep === 2 && !wizardManagerPassword.trim()) {
                        setWizardError('Please enter a manager password.');
                        return;
                      }
                      if (wizardStep === 4 && !isCloudTested) {
                        setWizardError('Please click "Test Cloud Connection" and verify your connection before proceeding to Step 5.');
                        return;
                      }
                      setWizardStep(wizardStep + 1);
                    }}
                    className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-5 py-2 text-xs font-bold text-white shadow"
                  >
                    Next Step
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleFinishWizard}
                    className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-6 py-2.5 text-xs font-bold text-white shadow cursor-pointer"
                  >
                    Complete Setup & Launch Business
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* In-app Toast Banner for Login Screen */}
        {toastMessage && (
          <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-2xl border border-emerald-300 bg-white px-4 py-3 text-xs font-semibold text-slate-900 shadow-xl ring-1 ring-black/5 animate-in fade-in slide-in-from-bottom-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>{toastMessage}</span>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="ml-2 text-slate-400 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // AUTHENTICATED WORKSPACE
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-2xl border border-emerald-300 bg-white px-4 py-3 text-xs font-semibold text-slate-900 shadow-xl ring-1 ring-black/5 animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{toastMessage}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="ml-2 text-slate-400 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 1. PORTFOLIO DEMO SANDBOX BAR (Only visible if demo mode activated) */}
      {isDemoModeActive && (
        <div className="no-print sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 text-xs shadow-xs">
          {/* Preset Switcher */}
          <div className="flex items-center gap-2">
            <span className="font-bold text-emerald-800 flex items-center gap-1.5">
              <Compass className="h-4 w-4 text-emerald-600" />
              <span>Sample Business:</span>
            </span>
            <select
              value={currentPresetId}
              onChange={(e) => handleSwitchPreset(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 focus:outline-none"
            >
              {PRESET_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* GPS Simulator Slider */}
          <div className="flex items-center gap-3">
            <span className="text-slate-600 flex items-center gap-1 text-[11px] font-semibold">
              <MapPin className="h-3.5 w-3.5 text-emerald-600" />
              <span>GPS Geofence Simulator:</span>
            </span>
            <input
              type="range"
              min={10}
              max={450}
              value={gpsSimMeters}
              onChange={(e) => setGpsSimMeters(Number(e.target.value))}
              className="w-24 md:w-36 accent-emerald-600 cursor-pointer"
            />
            <span
              className={`font-mono text-[11px] font-bold px-1.5 py-0.5 rounded ${
                gpsSimMeters <= state.settings.geofence.radiusMeters
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {gpsSimMeters}m {gpsSimMeters <= state.settings.geofence.radiusMeters ? '(Inside)' : '(Outside)'}
            </span>
          </div>

          {/* Split-Screen Live Simulator Toggle & Controls */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsSplitScreen(!isSplitScreen)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold border transition-colors ${
                isSplitScreen
                  ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Split className="h-3.5 w-3.5" />
              <span>Split-Screen Live View</span>
            </button>

            {/* Inactivity countdown badge */}
            <div
              className="hidden lg:flex items-center gap-1 font-mono text-[11px] text-slate-500 border border-slate-200 rounded-lg px-2 py-0.5 bg-slate-50"
              title="Auto-lock timer (resets on activity)"
            >
              <Clock className="h-3 w-3 text-slate-400" />
              <span>
                {Math.floor(inactivityRemaining / 60)}:{(inactivityRemaining % 60).toString().padStart(2, '0')}
              </span>
            </div>

            {/* Lock Vault button */}
            <button
              type="button"
              onClick={() => setIsLoggedIn(false)}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <LogOut className="h-3 w-3" />
              <span>Lock Vault</span>
            </button>
          </div>
        </div>
      )}

      {/* 2. MODE SWITCHER BAR (when not in Split-Screen) */}
      {!isSplitScreen && (
        <div className="no-print flex items-center justify-between border-b border-slate-200 bg-white px-6 py-2 text-xs shadow-xs">
          <div className="flex items-center gap-3">
            {/* Multi-Workspace Switcher Dropdown */}
            <div className="relative flex items-center gap-1.5">
              <div className="flex items-center gap-2 font-bold text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-xl border border-slate-200 transition">
                <div className="h-6 w-6 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700">
                  <Building2 className="h-3.5 w-3.5" />
                </div>
                <select
                  value={state.orgId || currentOrgId}
                  onChange={(e) => {
                    if (e.target.value === '__add_new__') {
                      setIsSetupWizardOpen(true);
                      setWizardStep(1);
                    } else {
                      handleSwitchWorkspace(e.target.value);
                    }
                  }}
                  className="bg-transparent font-bold text-xs text-slate-900 focus:outline-none cursor-pointer pr-1"
                >
                  {Object.entries(workspaces).map(([id, ws]) => (
                    <option key={id} value={id}>
                      {ws.settings.orgName}
                    </option>
                  ))}
                  <option value="__add_new__">+ Add / Switch Business</option>
                </select>
              </div>
            </div>

            {/* Network Resilience Status Pill */}
            <div
              className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                !isOnline
                  ? 'bg-rose-50 text-rose-800 border-rose-200'
                  : reconnectedBanner
                  ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                  : getIsDirty()
                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-emerald-50 text-emerald-800 border-emerald-200'
              }`}
              title={
                !isOnline
                  ? 'Network connection lost. Changes saved locally in browser.'
                  : 'Real-time synchronization status'
              }
            >
              {!isOnline ? (
                <>
                  <WifiOff className="h-3 w-3 text-rose-600" />
                  <span>Working Offline</span>
                </>
              ) : reconnectedBanner ? (
                <>
                  <Wifi className="h-3 w-3 text-emerald-600" />
                  <span>Reconnected</span>
                </>
              ) : getIsDirty() ? (
                <>
                  <RefreshCw className="h-3 w-3 text-amber-600 animate-spin" />
                  <span>Unsaved Changes</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  <span>Online & Clean</span>
                </>
              )}
            </div>

            <div className="flex rounded-lg border border-slate-200 p-0.5 bg-slate-100">
              <button
                type="button"
                onClick={() => setAppMode('manager')}
                className={`rounded-md px-3 py-1 font-bold text-xs transition-colors ${
                  appMode === 'manager' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Manager Dashboard
              </button>
              {isMobileAllowed && (
                <button
                  type="button"
                  onClick={() => setAppMode('staff')}
                  className={`rounded-md px-3 py-1 font-bold text-xs transition-colors ${
                    appMode === 'staff' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Employee Mobile View
                </button>
              )}
              {isKioskAllowed && (
                <button
                  type="button"
                  onClick={() => setAppMode('kiosk')}
                  className={`rounded-md px-3 py-1 font-bold text-xs transition-colors ${
                    appMode === 'kiosk' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Kiosk Terminal
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {appMode === 'staff' && state.employees.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 text-xs">Switch Employee:</span>
                <select
                  value={currentEmployee?.id || ''}
                  onChange={(e) => {
                    const emp = state.employees.find((emp) => emp.id === e.target.value);
                    if (emp) setCurrentEmployee(emp);
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
                >
                  {state.employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} (@{emp.username})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Inactivity indicator if demo bar is hidden */}
            {!isDemoModeActive && appMode !== 'kiosk' && (
              <div
                className="hidden md:flex items-center gap-1 text-[11px] text-slate-500 font-mono"
                title="Auto-locks when idle"
              >
                <Clock className="h-3 w-3 text-slate-400" />
                <span>
                  {Math.floor(inactivityRemaining / 60)}:{(inactivityRemaining % 60).toString().padStart(2, '0')}
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={() => setIsLoggedIn(false)}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <LogOut className="h-3.5 w-3.5 text-slate-500" />
              <span>Lock Vault</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. SPLIT-SCREEN LIVE SIMULATOR MODE */}
      {isSplitScreen ? (
        <div className="flex flex-1 flex-col lg:flex-row overflow-hidden bg-slate-100">
          {/* Left: Manager Dashboard (65% width) */}
          <div className="flex-1 lg:w-[65%] border-r border-slate-200 overflow-y-auto bg-slate-50">
            <ManagerDashboard
              state={state}
              onUpdateState={handleUpdateState}
              onOpenPluginModal={() => setIsPluginModalOpen(true)}
              gpsSimMeters={gpsSimMeters}
              onSimulateTamperAttack={handleSimulateTamperAttack}
            />
          </div>

          {/* Right: Interactive Smartphone Frame (35% width) */}
          <div className="lg:w-[35%] bg-slate-100 p-6 flex flex-col items-center justify-start overflow-y-auto">
            <div className="mb-3 flex items-center justify-between w-full max-w-sm px-2">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Smartphone className="h-4 w-4 text-emerald-600" />
                Employee Mobile View
              </span>
              <select
                value={activeSimulatorEmployeeId}
                onChange={(e) => setActiveSimulatorEmployeeId(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-800"
              >
                {state.employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Mobile Device Frame */}
            <div className="w-full max-w-sm rounded-[40px] border-8 border-slate-800 bg-white shadow-2xl overflow-hidden ring-4 ring-slate-300">
              {/* Speaker / Notch bar */}
              <div className="bg-slate-800 py-1.5 flex justify-center">
                <div className="h-3.5 w-24 rounded-full bg-slate-900" />
              </div>

              {/* Mobile Viewport */}
              <div className="h-[750px] overflow-y-auto">
                {simulatorEmployee && (
                  <StaffMobileView
                    state={state}
                    currentEmployee={simulatorEmployee}
                    workspaces={workspaces}
                    onSwitchWorkspace={handleSwitchWorkspace}
                    onUpdateEmployee={(updated) => {
                      handleUpdateState(
                        {
                          ...state,
                          employees: state.employees.map((e) => (e.id === updated.id ? updated : e)),
                        },
                        {
                          name: updated.name,
                          role: 'staff',
                          action: 'PROFILE_UPDATED',
                          details: `${updated.name} updated account information`,
                        }
                      );
                    }}
                    onRecordPunch={handleRecordPunch}
                    onClaimShift={handleClaimShift}
                    onPostShiftUpForGrabs={handlePostShiftUpForGrabs}
                    onAddAvailability={handleAddAvailability}
                    onDeleteAvailability={handleDeleteAvailability}
                    onSubmitTimeOff={handleSubmitTimeOff}
                    onSendMessage={handleSendMessage}
                    onStaffLogout={() => setIsLoggedIn(false)}
                    gpsSimMeters={gpsSimMeters}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* STANDARD SINGLE-VIEW MODES */
        <div className="flex-1">
          {appMode === 'manager' && (
            <ManagerDashboard
              state={state}
              onUpdateState={handleUpdateState}
              onOpenPluginModal={() => setIsPluginModalOpen(true)}
              gpsSimMeters={gpsSimMeters}
              onSimulateTamperAttack={handleSimulateTamperAttack}
            />
          )}

          {appMode === 'staff' && currentEmployee && (
  <StaffMobileView
    state={state}
    currentEmployee={currentEmployee}
    workspaces={workspaces}
    onSwitchWorkspace={handleSwitchWorkspace}
    onUpdateEmployee={(updated) => {
                handleUpdateState(
                  {
                    ...state,
                    employees: state.employees.map((e) => (e.id === updated.id ? updated : e)),
                  },
                  {
                    name: updated.name,
                    role: 'staff',
                    action: 'PROFILE_UPDATED',
                    details: `${updated.name} updated account information`,
                  }
                );
                setCurrentEmployee(updated);
              }}
              onRecordPunch={handleRecordPunch}
    onClaimShift={handleClaimShift}
    onPostShiftUpForGrabs={handlePostShiftUpForGrabs}
    onAddAvailability={handleAddAvailability}
    onDeleteAvailability={handleDeleteAvailability}
    onSubmitTimeOff={handleSubmitTimeOff}
    onSendMessage={handleSendMessage}
    onStaffLogout={() => setIsLoggedIn(false)}
    gpsSimMeters={gpsSimMeters}
    // Remove the duplicate props below if they appear a second time:
    // workspaces={workspaces}
    // onSwitchWorkspace={handleSwitchWorkspace}
  />
)}

          {appMode === 'kiosk' && (
            <KioskTimeclock
              state={state}
              onRecordPunch={handleRecordPunch}
              onExitKiosk={() => setAppMode('manager')}
              gpsSimMeters={gpsSimMeters}
            />
          )}
        </div>
      )}

      {/* CLOUD SYNC CONFLICT RESOLUTION MODAL */}
      {syncConflict && syncConflict.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-amber-600 mb-3">
              <ShieldAlert className="h-6 w-6" />
              <h3 className="text-base font-bold text-slate-900">
                Cloud Backup Conflict Detected
              </h3>
            </div>
            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              A newer version of your business schedule was detected in the cloud backup slot. Choose how you would like to resolve the difference:
            </p>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 mb-5 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Remote Cloud Version:</span>
                <span className="font-bold text-slate-900">
                  {new Date(syncConflict.cloudVersionTimestampMs).toLocaleTimeString()} by {syncConflict.cloudLastModifiedBy}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Your Local Version:</span>
                <span className="font-bold text-slate-900">
                  {new Date(syncConflict.localVersionTimestampMs).toLocaleTimeString()} (Current Device)
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  handleUpdateState(syncConflict.cloudState);
                  setSyncConflict(null);
                  showToast('✓ Accepted latest cloud version.');
                }}
                className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-xs"
              >
                Accept Cloud Version
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await atomicCloudWrite(state);
                    setSyncConflict(null);
                    showToast('✓ Overwrote cloud backup with local schedule.');
                  } catch (err: any) {
                    showToast(`Error: ${err.message}`);
                  }
                }}
                className="rounded-xl border border-slate-300 bg-white hover:bg-slate-50 px-4 py-2 text-xs font-bold text-slate-700"
              >
                Overwrite Cloud with Local Version
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PLUGIN MODAL */}
      <PluginModal
        isOpen={isPluginModalOpen}
        onClose={() => setIsPluginModalOpen(false)}
        state={state}
        onUpdatePlugins={(updatedPlugins) => {
          handleUpdateState({
            ...state,
            plugins: updatedPlugins,
          });
        }}
      />
    </div>
  );
}
