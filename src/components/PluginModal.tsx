/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import {
  Check,
  Download,
  Globe,
  Layers,
  Plus,
  Play,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Upload,
  X,
} from 'lucide-react';
import { OrganizationState, PluginDefinition } from '../types';
import { COMMUNITY_PLUGINS_REGISTRY } from '../communityPlugins';

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
  const [activeMainTab, setActiveMainTab] = useState<'installed' | 'community' | 'upload'>('installed');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const installedPlugins = state.plugins;

  // Toggle plugin active state
  const handleToggle = (pluginId: string) => {
    const updated = installedPlugins.map((p) =>
      p.id === pluginId ? { ...p, enabled: !p.enabled } : p
    );
    onUpdatePlugins(updated);
  };

  // Remove plugin from dashboard
  const handleRemovePlugin = (pluginId: string) => {
    const updated = installedPlugins.filter((p) => p.id !== pluginId);
    onUpdatePlugins(updated);
    setSuccessMessage('Plugin removed successfully.');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  // Add prebuilt community plugin
  const handleAddCommunityPlugin = (communityPlugin: PluginDefinition) => {
    if (installedPlugins.some((p) => p.id === communityPlugin.id)) {
      setSuccessMessage('Plugin is already added to your dashboard.');
      setTimeout(() => setSuccessMessage(null), 3000);
      return;
    }
    const updated = [...installedPlugins, { ...communityPlugin, enabled: true }];
    onUpdatePlugins(updated);
    setSuccessMessage(`✓ Added "${communityPlugin.name}" to your dashboard!`);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  // Handle .zip or code file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string || '// Custom uploaded plugin code';
      const pluginName = file.name.replace(/\.[^/.]+$/, '');
      const newPlugin = {
        id: `plugin_custom_${Date.now()}`,
        name: pluginName,
        description: `Custom plugin imported from file: ${file.name}`,
        version: '1.0.0',
        author: 'Custom Upload',
        category: 'integrations',
        enabled: true,
      } as PluginDefinition;

      Object.assign(newPlugin, { code: content });

      onUpdatePlugins([...installedPlugins, newPlugin]);
      setSuccessMessage(`✓ Successfully uploaded and installed "${pluginName}"!`);
      setTimeout(() => setSuccessMessage(null), 3500);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="flex h-[85vh] w-full max-w-4xl flex-col rounded-3xl border border-slate-200 bg-white text-slate-800 shadow-2xl overflow-hidden animate-in fade-in">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-emerald-100 p-2.5 text-emerald-700">
              <Layers className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Plugin Marketplace & Manager</h2>
              <p className="text-xs text-slate-500">
                Extend Open Schedule with prebuilt community integrations or custom code uploads
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50/50 px-6 gap-2 pt-2">
          <button
            type="button"
            onClick={() => setActiveMainTab('installed')}
            className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all ${
              activeMainTab === 'installed'
                ? 'bg-white text-emerald-800 border-t border-x border-slate-200 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Installed Plugins ({installedPlugins.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveMainTab('community')}
            className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all ${
              activeMainTab === 'community'
                ? 'bg-white text-emerald-800 border-t border-x border-slate-200 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            🌐 Browse Community Plugins
          </button>
          <button
            type="button"
            onClick={() => setActiveMainTab('upload')}
            className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all ${
              activeMainTab === 'upload'
                ? 'bg-white text-emerald-800 border-t border-x border-slate-200 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            📦 Add Plugin from .zip / Code File
          </button>
        </div>

        {/* Toast Notification */}
        {successMessage && (
          <div className="mx-6 mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800 flex items-center gap-2">
            <Check className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-white">
          {/* TAB 1: Installed Plugins */}
          {activeMainTab === 'installed' && (
            <div className="space-y-4">
              {installedPlugins.length === 0 ? (
                <div className="py-16 text-center text-xs text-slate-400 italic">
                  No plugins installed. Browse Community Plugins or upload a .zip file to get started!
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {installedPlugins.map((plugin) => (
                    <div
                      key={plugin.id}
                      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <h3 className="font-bold text-sm text-slate-900">{plugin.name}</h3>
                          <button
                            type="button"
                            onClick={() => handleToggle(plugin.id)}
                            className="text-slate-400 hover:text-emerald-600"
                            title="Toggle Individual Plugin"
                          >
                            {plugin.enabled ? (
                              <ToggleRight className="h-6 w-6 text-emerald-600" />
                            ) : (
                              <ToggleLeft className="h-6 w-6 text-slate-400" />
                            )}
                          </button>
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed mb-3">
                          {plugin.description}
                        </p>
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs">
                        <span className="text-slate-400 font-mono text-[11px]">v{plugin.version} • {plugin.author}</span>
                        <button
                          type="button"
                          onClick={() => handleRemovePlugin(plugin.id)}
                          className="flex items-center gap-1 text-rose-600 hover:text-rose-700 font-semibold text-[11px]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Browse Community Plugins */}
          {activeMainTab === 'community' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 mb-2">
                Prebuilt community integrations. Click <strong className="text-emerald-700">Add</strong> to install them instantly to your dashboard.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {COMMUNITY_PLUGINS_REGISTRY.map((comm) => {
                  const isAlreadyAdded = installedPlugins.some((p) => p.id === comm.id);
                  return (
                    <div
                      key={comm.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 shadow-sm flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <h3 className="font-bold text-sm text-slate-900">{comm.name}</h3>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 capitalize">
                            {comm.category}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed mb-3">
                          {comm.description}
                        </p>
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-slate-200 text-xs">
                        <span className="text-slate-400 font-mono text-[11px]">{comm.author}</span>
                        <button
                          type="button"
                          disabled={isAlreadyAdded}
                          onClick={() => handleAddCommunityPlugin(comm)}
                          className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {isAlreadyAdded ? (
                            <>
                              <Check className="h-3.5 w-3.5" />
                              <span>Added</span>
                            </>
                          ) : (
                            <>
                              <Plus className="h-3.5 w-3.5" />
                              <span>Add to Dashboard</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: Add Plugin from .zip / Code File */}
          {activeMainTab === 'upload' && (
            <div className="py-12 px-6 text-center max-w-md mx-auto space-y-4">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".zip,.js,.ts,.json,.txt"
                className="hidden"
              />
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                <Upload className="h-7 w-7" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Upload Plugin Code or .zip Archive</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Upload a `.zip` plugin package or individual script file. Open Schedule will automatically parse, validate, and install it to your active workspace.
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-6 py-3 text-xs font-bold text-white shadow hover:bg-emerald-700 transition-colors cursor-pointer"
              >
                <Upload className="h-4 w-4" />
                <span>Select .zip or Code File</span>
              </button>
            </div>
          )}
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