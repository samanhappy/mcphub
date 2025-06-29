import React, { ReactNode } from 'react';
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
  children
}) => {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isSelected}
      className={cn(
        "flex w-full items-center justify-between p-2 rounded transition-colors cursor-pointer",
        isSelected
          ? "bg-blue-50 text-blue-700 hover:bg-blue-100 border-l-4 border-blue-500"
          : "hover:bg-gray-50 text-gray-700"
      )}
      onClick={onClick}
    >
      <span className="flex items-center">
        {children}
      </span>
      {isSelected && (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-blue-500">
          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
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
  noOptionsText = "No options available",
  values,
  options,
  onChange,
  className
}) => {
  const handleToggle = (value: string) => {
    const isSelected = values.includes(value);
    if (isSelected) {
      onChange(values.filter(v => v !== value));
    } else {
      onChange([...values, value]);
    }
  };

  return (
    <div className={className}>
      <label className="block text-gray-700 text-sm font-bold mb-2">
        {label}
      </label>
      <div className="border border-gray-200 rounded shadow max-h-60 overflow-y-auto">
        {options.length === 0 ? (
          <p className="text-gray-500 text-sm p-3">{noOptionsText}</p>
        ) : (
          <div className="space-y-1 p-1">
            {options.map(option => (
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
      {helpText && (
        <p className="text-xs text-gray-500 mt-1">
          {helpText}
        </p>
      )}
    </div>
  );
};

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onCheckedChange,
  disabled = false
}) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500",
        checked ? "bg-blue-200" : "bg-gray-100",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      )}
      onClick={() => !disabled && onCheckedChange(!checked)}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
          checked ? "translate-x-6" : "translate-x-1"
        )}
      />
    </button>
  );
};