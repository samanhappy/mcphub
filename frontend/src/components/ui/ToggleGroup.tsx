import React, { ReactNode, useId } from 'react';
import { cn } from '@/utils/cn';

interface ToggleGroupItemProps {
  value: string;
  isSelected: boolean;
  onClick: () => void;
  children: ReactNode;
}

export const ToggleGroupItem: React.FC<ToggleGroupItemProps> = ({
  isSelected,
  onClick,
  children,
}) => {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isSelected}
      className={cn(
        'flex w-full cursor-pointer items-center justify-between rounded p-2 transition-colors',
        isSelected
          ? 'border-l-4 border-blue-500 bg-blue-50 text-blue-700 hover:bg-blue-100'
          : 'text-gray-700 hover:bg-gray-50',
      )}
      onClick={onClick}
    >
      <span className="flex items-center">{children}</span>
      {isSelected && (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-blue-500">
          <path
            fillRule="evenodd"
            d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
            clipRule="evenodd"
          />
        </svg>
      )}
    </button>
  );
};

interface ToggleGroupProps {
  label: string;
  helpText?: string;
  noOptionsText?: string;
  values: string[];
  options: { value: string; label: string }[];
  onChange: (values: string[]) => void;
  className?: string;
}

export const ToggleGroup: React.FC<ToggleGroupProps> = ({
  label,
  helpText,
  noOptionsText = 'No options available',
  values,
  options,
  onChange,
  className,
}) => {
  const labelId = useId();

  const handleToggle = (value: string) => {
    const isSelected = values.includes(value);
    if (isSelected) {
      onChange(values.filter((v) => v !== value));
    } else {
      onChange([...values, value]);
    }
  };

  return (
    <div className={className}>
      <div id={labelId} className="mb-2 block text-sm font-bold text-gray-700">{label}</div>
      <div
        role="group"
        aria-labelledby={labelId}
        className="max-h-60 overflow-y-auto rounded border border-gray-200 shadow dark:border-gray-700"
      >
        {options.length === 0 ? (
          <p className="p-3 text-sm text-gray-500">{noOptionsText}</p>
        ) : (
          <div className="space-y-1 p-1">
            {options.map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                isSelected={values.includes(option.value)}
                onClick={() => handleToggle(option.value)}
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </div>
        )}
      </div>
      {helpText && <p className="mt-1 text-xs text-gray-500">{helpText}</p>}
    </div>
  );
};

interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onChange' | 'role' | 'type'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  size?: 'regular' | 'card' | 'compact';
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onCheckedChange,
  disabled = false,
  size = 'regular',
  className,
  onClick,
  ...buttonProps
}) => {
  return (
    <button
      {...buttonProps}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cn(
        'hub-switch',
        checked && 'on',
        size === 'card' && 'card',
        size === 'compact' && 'compact',
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
        if (!event.defaultPrevented && !disabled) {
          onCheckedChange(!checked);
        }
      }}
    />
  );
};