'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Optional label rendered next to the checkbox. */
  label?: React.ReactNode;
  /** Optional description (renders under the label). */
  description?: React.ReactNode;
}

/**
 * Checkbox — a styled native checkbox with optional inline label.
 *
 * Prefer this over a button-group toggle because the native semantics
 * (role=checkbox, aria-checked) make screen-reader behaviour correct
 * out of the box. The label is rendered via a sibling `<label>` so
 * clicking the text toggles the input.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, description, disabled, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    if (!label && !description) {
      return (
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          disabled={disabled}
          className={cn(
            'h-4 w-4 rounded border-border text-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
          {...props}
        />
      );
    }
    return (
      <label
        htmlFor={inputId}
        className={cn(
          'flex cursor-pointer items-start gap-3 rounded-md border border-input px-3 py-2 text-sm transition-colors',
          'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2',
          disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          disabled={disabled}
          className={cn(
            'mt-0.5 h-4 w-4 rounded border-border text-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
          {...props}
        />
        <span className="flex flex-col gap-0.5 leading-tight">
          {label ? (
            <span className="font-medium text-foreground">{label}</span>
          ) : null}
          {description ? (
            <span className="text-xs text-muted-foreground">
              {description}
            </span>
          ) : null}
        </span>
      </label>
    );
  }
);
Checkbox.displayName = 'Checkbox';
