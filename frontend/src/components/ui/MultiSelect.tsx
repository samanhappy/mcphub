import React, { useState, useRef, useEffect } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';

interface MultiSelectProps {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
  options,
  selected,
  onChange,
  placeholder = 'Select items...',
  disabled = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = options.filter((option) =>
    option.label.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleToggleOption = (value: string) => {
    if (disabled) return;

    const newSelected = selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value];

    onChange(newSelected);
  };

  const handleRemoveItem = (value: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    onChange(selected.filter((item) => item !== value));
  };

  const handleToggleDropdown = () => {
    if (disabled) return;
    setIsOpen(!isOpen);
    if (!isOpen) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const getSelectedLabels = () => {
    return selected
      .map((value) => options.find((opt) => opt.value === value)?.label || value)
      .filter(Boolean);
  };

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      {/* Selected items display */}
      <div
        onClick={handleToggleDropdown}
        className={`
          min-h-[38px] w-full px-3 py-1.5 border rounded-md shadow-sm
          flex flex-wrap items-center gap-1.5 cursor-pointer
          transition-all duration-200
          ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white hover:border-blue-400'}
          ${isOpen ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-300'}
        `}
      >
        {selected.length > 0 ? (
          <>
            {getSelectedLabels().map((label, index) => (
              <span
                key={selected[index]}
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"
              >
                {label}
                {!disabled && (
                  <button
                    type="button"
                    onClick={(e) => handleRemoveItem(selected[index], e)}
                    className="ml-1 hover:bg-blue-200 rounded-full p-0.5 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </>
        ) : (
          <span className="text-gray-400 text-sm">{placeholder}</span>
        )}
        <div className="flex-1"></div>
        <ChevronDown
          className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'transform rotate-180' : ''}`}
        />
      </div>

      {/* Dropdown menu */}
      {isOpen && !disabled && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-gray-200">
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search..."
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          {/* Options list */}
          <div className="max-h-48 overflow-y-auto">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => {
                const isSelected = selected.includes(option.value);
                return (
                  <div
                    key={option.value}
                    onClick={() => handleToggleOption(option.value)}
                    className={`
                      px-3 py-2 cursor-pointer flex items-center justify-between
                      transition-colors duration-150
                      ${isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-100'}
                    `}
                  >
                    <span className="text-sm">{option.label}</span>
                    {isSelected && <Check className="h-4 w-4 text-blue-600" />}
                  </div>
                );
              })
            ) : (
              <div className="px-3 py-2 text-sm text-gray-500 text-center">
                {searchTerm ? 'No results found' : 'No options available'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
