/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Loader2, Check, AlertCircle } from 'lucide-react';

interface SmartNumberInputProps {
  value: number;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  defaultValueOnBlur?: number;
  className?: string;
  disabled?: boolean;
  prefix?: string;
  suffix?: string;
  ariaLabel?: string;
}

/**
 * SmartNumberInput:
 * - Strips leading zeros immediately as you type (typing 40 never leaves 040).
 * - Allows the user to backspace completely empty ("") while typing without forcing 0.
 * - Applies fallback default number only onBlur.
 */
export const SmartNumberInput: React.FC<SmartNumberInputProps> = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  placeholder,
  defaultValueOnBlur = 0,
  className = '',
  disabled = false,
  prefix,
  suffix,
  ariaLabel,
}) => {
  const [text, setText] = useState<string>(() => (isNaN(value) ? '' : String(value)));
  const isFocusedRef = useRef(false);

  // Sync external prop changes only when not actively typing/focused
  useEffect(() => {
    if (!isFocusedRef.current) {
      setText(isNaN(value) ? '' : String(value));
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value;

    // Allow empty string while typing
    if (raw === '') {
      setText('');
      return;
    }

    // Only allow numbers and one decimal dot
    raw = raw.replace(/[^\d.]/g, '');
    const parts = raw.split('.');
    if (parts.length > 2) {
      raw = parts[0] + '.' + parts.slice(1).join('');
    }

    // Strip leading zero unless it's strictly "0" or "0."
    if (raw.length > 1 && raw.startsWith('0') && !raw.startsWith('0.')) {
      raw = raw.replace(/^0+(?=\d)/, '');
    }

    setText(raw);

    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) {
      let clamped = parsed;
      if (max !== undefined && clamped > max) clamped = max;
      onChange(clamped);
    }
  };

  const handleBlur = () => {
    isFocusedRef.current = false;
    let finalNum = parseFloat(text);
    if (isNaN(finalNum) || text === '') {
      finalNum = defaultValueOnBlur;
    }
    if (min !== undefined && finalNum < min) finalNum = min;
    if (max !== undefined && finalNum > max) finalNum = max;

    setText(String(finalNum));
    onChange(finalNum);
  };

  const handleFocus = () => {
    isFocusedRef.current = true;
  };

  return (
    <div className="relative inline-flex items-center w-full">
      {prefix && (
        <span className="absolute left-3 text-slate-400 font-medium select-none pointer-events-none text-sm">
          {prefix}
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        disabled={disabled}
        aria-label={ariaLabel}
        placeholder={placeholder}
        step={step}
        className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono tabular-nums text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 disabled:bg-slate-100 disabled:text-slate-400 ${
          prefix ? 'pl-7' : ''
        } ${suffix ? 'pr-8' : ''} ${className}`}
      />
      {suffix && (
        <span className="absolute right-3 text-slate-400 font-medium select-none pointer-events-none text-sm">
          {suffix}
        </span>
      )}
    </div>
  );
};

export interface ActionButtonProps {
  onClick: () => Promise<boolean | void> | boolean | void;
  idleLabel?: React.ReactNode;
  idleText?: React.ReactNode;
  workingLabel?: React.ReactNode;
  workingText?: React.ReactNode;
  successLabel?: React.ReactNode;
  successText?: React.ReactNode;
  errorLabel?: React.ReactNode;
  errorText?: React.ReactNode;
  icon?: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'outline' | 'subtle';
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
  ariaLabel?: string;
}

/**
 * ActionButton:
 * - Debounces rapid clicks.
 * - Shows an immediate spinning working state.
 * - Shows 2.5-second success (✓ Saved / Confirmed!) or failure state before returning to idle.
 */
export const ActionButton: React.FC<ActionButtonProps> = ({
  onClick,
  idleLabel,
  idleText,
  workingLabel,
  workingText,
  successLabel,
  successText,
  errorLabel,
  errorText,
  icon,
  variant = 'primary',
  className = '',
  disabled = false,
  type = 'button',
  title,
  ariaLabel,
}) => {
  const [state, setState] = useState<'idle' | 'working' | 'success' | 'error'>('idle');
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const effectiveIdle = idleLabel || idleText || 'Confirm';
  const effectiveWorking = workingLabel || workingText || 'Working...';
  const effectiveSuccess = successLabel || successText || '✓ Confirmed!';
  const effectiveError = errorLabel || errorText || '✕ Failed';

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (state !== 'idle' || disabled) return;
    if (type !== 'submit') {
      e.preventDefault();
    }

    setState('working');
    try {
      const result = await Promise.resolve(onClick());
      if (result === false) {
        setState('error');
      } else {
        setState('success');
      }
    } catch {
      setState('error');
    }

    timerRef.current = setTimeout(() => {
      setState('idle');
    }, 2500);
  };

  const variantStyles = {
    primary:
      'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 focus:ring-emerald-500 shadow-sm',
    secondary:
      'bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300 focus:ring-slate-400 border border-slate-200',
    danger:
      'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 focus:ring-rose-500 shadow-sm',
    outline:
      'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 active:bg-slate-100 focus:ring-emerald-500',
    subtle:
      'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 active:bg-emerald-200 border border-emerald-200',
  }[variant];

  return (
    <button
      type={type}
      onClick={handleClick}
      disabled={disabled || state !== 'idle'}
      title={title}
      aria-label={ariaLabel}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 select-none ${
        state === 'success'
          ? 'bg-emerald-700 text-white shadow-sm ring-2 ring-emerald-500'
          : state === 'error'
          ? 'bg-rose-700 text-white shadow-sm ring-2 ring-rose-500'
          : variantStyles
      } ${className}`}
    >
      {state === 'working' && (
        <>
          <Loader2 className="w-4 h-4 animate-spin text-current" />
          <span>{effectiveWorking}</span>
        </>
      )}
      {state === 'success' && (
        <>
          <Check className="w-4 h-4 text-emerald-200" />
          <span>{effectiveSuccess}</span>
        </>
      )}
      {state === 'error' && (
        <>
          <AlertCircle className="w-4 h-4 text-rose-200" />
          <span>{effectiveError}</span>
        </>
      )}
      {state === 'idle' && (
        <>
          {icon}
          {effectiveIdle}
        </>
      )}
    </button>
  );
};

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  description?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  description,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  const bodyText = description || message || '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl border border-slate-200">
        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">{bodyText}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition ${
              variant === 'danger'
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
