'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /**
   * Render as a child element, merging props onto the first descendant.
   * When true, the ref is forwarded to that child via React.cloneElement.
   */
  asChild?: boolean;
}

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  link: 'text-primary underline-offset-4 hover:underline',
};

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  default: 'h-10 px-4 py-2',
  sm: 'h-9 rounded-md px-3 text-xs',
  lg: 'h-11 rounded-md px-8 text-base',
  icon: 'h-10 w-10',
};

const baseClasses =
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';

/**
 * Button
 *
 * NOTE: Previously used `React.Fragment` as the underlying component when
 * `asChild` was set, which conflicted with React.forwardRef's HTMLButtonElement
 * ref type (TS2322 — FragmentInstance is not assignable to HTMLButtonElement).
 *
 * We now resolve to a real element-type at render-time. When `asChild` is set,
 * we walk the rendered children and `cloneElement` to merge className/event
 * handlers, mimicking Radix Slot behavior. The ref is then forwarded to that
 * child element.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', asChild = false, children, ...props }, ref) => {
    const composedClassName = cn(
      baseClasses,
      variantClasses[variant],
      sizeClasses[size],
      className
    );

    if (asChild && React.isValidElement(children)) {
      // Merge into the single child element. Forward the ref so consumers
      // like dropdown triggers still get a DOM node. The child's existing
      // `ref` is preserved via mergeRefs and its `className` is merged.
      const child = children as React.ReactElement<{ className?: string }> & {
        ref?: React.Ref<HTMLElement>;
      };
      const childProps: Record<string, unknown> = {
        ...props,
        className: cn(composedClassName, (child.props as { className?: string }).className),
      };
      if (ref) {
        childProps.ref = mergeRefs<HTMLElement>(ref as unknown as React.Ref<HTMLElement>, child.ref);
      }
      return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, childProps);
    }

    return (
      <button
        ref={ref}
        className={composedClassName}
        type={props.type ?? 'button'}
        {...props}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';

export { Button };

/**
 * Combine multiple refs into one. Useful when forwarding through cloneElement.
 */
function mergeRefs<T>(...refs: (React.Ref<T> | undefined)[]): React.RefCallback<T> {
  return (value) => {
    refs.forEach((r) => {
      if (!r) return;
      if (typeof r === 'function') {
        r(value);
      } else {
        (r as React.MutableRefObject<T | null>).current = value;
      }
    });
  };
}
