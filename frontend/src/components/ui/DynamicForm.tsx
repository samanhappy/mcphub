import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ToolInputSchema } from '@/types';

interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: any[];
  description?: string;
  default?: any;
}

interface DynamicFormProps {
  schema: ToolInputSchema;
  onSubmit: (values: Record<string, any>) => void;
  onCancel: () => void;
  loading?: boolean;
  storageKey?: string; // Optional key for localStorage persistence
}

const DynamicForm: React.FC<DynamicFormProps> = ({ schema, onSubmit, onCancel, loading = false, storageKey }) => {
  const { t } = useTranslation();
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Convert ToolInputSchema to JsonSchema - memoized to prevent infinite re-renders
  const jsonSchema = useMemo(() => {
    const convertToJsonSchema = (schema: ToolInputSchema): JsonSchema => {
      const convertProperty = (prop: unknown): JsonSchema => {
        if (typeof prop === 'object' && prop !== null) {
          const obj = prop as any;
          return {
            type: obj.type || 'string',
            description: obj.description,
            enum: obj.enum,
            default: obj.default,
            properties: obj.properties ? Object.fromEntries(
              Object.entries(obj.properties).map(([key, value]) => [key, convertProperty(value)])
            ) : undefined,
            required: obj.required,
            items: obj.items ? convertProperty(obj.items) : undefined,
          };
        }
        return { type: 'string' };
      };

      return {
        type: schema.type,
        properties: schema.properties ? Object.fromEntries(
          Object.entries(schema.properties).map(([key, value]) => [key, convertProperty(value)])
        ) : undefined,
        required: schema.required,
      };
    };

    return convertToJsonSchema(schema);
  }, [schema]);

  // Initialize form values with defaults or from localStorage
  useEffect(() => {
    const initializeValues = (schema: JsonSchema, path: string = ''): Record<string, any> => {
      const values: Record<string, any> = {};

      if (schema.type === 'object' && schema.properties) {
        Object.entries(schema.properties).forEach(([key, propSchema]) => {
          const fullPath = path ? `${path}.${key}` : key;
          if (propSchema.default !== undefined) {
            values[key] = propSchema.default;
          } else if (propSchema.type === 'string') {
            values[key] = '';
          } else if (propSchema.type === 'number' || propSchema.type === 'integer') {
            values[key] = 0;
          } else if (propSchema.type === 'boolean') {
            values[key] = false;
          } else if (propSchema.type === 'array') {
            values[key] = [];
          } else if (propSchema.type === 'object') {
            values[key] = initializeValues(propSchema, fullPath);
          }
        });
      }

      return values;
    };

    let initialValues = initializeValues(jsonSchema);

    // Try to load saved form data from localStorage
    if (storageKey) {
      try {
        const savedData = localStorage.getItem(storageKey);
        if (savedData) {
          const parsedData = JSON.parse(savedData);
          // Merge saved data with initial values, preserving structure
          initialValues = { ...initialValues, ...parsedData };
        }
      } catch (error) {
        console.warn('Failed to load saved form data:', error);
      }
    }

    setFormValues(initialValues);
  }, [jsonSchema, storageKey]);

  const handleInputChange = (path: string, value: any) => {
    setFormValues(prev => {
      const newValues = { ...prev };
      const keys = path.split('.');
      let current = newValues;

      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]]) {
          current[keys[i]] = {};
        }
        current = current[keys[i]];
      }

      current[keys[keys.length - 1]] = value;

      // Save to localStorage if storageKey is provided
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(newValues));
        } catch (error) {
          console.warn('Failed to save form data to localStorage:', error);
        }
      }

      return newValues;
    });

    // Clear error for this field
    if (errors[path]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[path];
        return newErrors;
      });
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    const validateObject = (schema: JsonSchema, values: any, path: string = '') => {
      if (schema.type === 'object' && schema.properties) {
        Object.entries(schema.properties).forEach(([key, propSchema]) => {
          const fullPath = path ? `${path}.${key}` : key;
          const value = values?.[key];

          // Check required fields
          if (schema.required?.includes(key) && (value === undefined || value === null || value === '')) {
            newErrors[fullPath] = `${key} is required`;
            return;
          }

          // Validate type
          if (value !== undefined && value !== null && value !== '') {
            if (propSchema.type === 'string' && typeof value !== 'string') {
              newErrors[fullPath] = `${key} must be a string`;
            } else if (propSchema.type === 'number' && typeof value !== 'number') {
              newErrors[fullPath] = `${key} must be a number`;
            } else if (propSchema.type === 'integer' && (!Number.isInteger(value) || typeof value !== 'number')) {
              newErrors[fullPath] = `${key} must be an integer`;
            } else if (propSchema.type === 'boolean' && typeof value !== 'boolean') {
              newErrors[fullPath] = `${key} must be a boolean`;
            } else if (propSchema.type === 'object' && typeof value === 'object') {
              validateObject(propSchema, value, fullPath);
            }
          }
        });
      }
    };

    validateObject(jsonSchema, formValues);
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      onSubmit(formValues);
    }
  };

  const renderField = (key: string, propSchema: JsonSchema, path: string = ''): React.ReactNode => {
    const fullPath = path ? `${path}.${key}` : key;
    const value = formValues[key];
    const error = errors[fullPath];

    if (propSchema.type === 'string') {
      if (propSchema.enum) {
        return (
          <div key={fullPath} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {key}
              {jsonSchema.required?.includes(key) && <span className="text-red-500 ml-1">*</span>}
            </label>
            {propSchema.description && (
              <p className="text-xs text-gray-500 mb-2">{propSchema.description}</p>
            )}
            <select
              value={value || ''}
              onChange={(e) => handleInputChange(fullPath, e.target.value)}
              className={`w-full border rounded-md px-3 py-2 ${error ? 'border-red-500' : 'border-gray-300'} focus:outline-none focus:ring-2 focus:ring-blue-500`}
            >
              <option value="">{t('tool.selectOption')}</option>
              {propSchema.enum.map((option, idx) => (
                <option key={idx} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
          </div>
        );
      } else {
        return (
          <div key={fullPath} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {key}
              {jsonSchema.required?.includes(key) && <span className="text-red-500 ml-1">*</span>}
            </label>
            {propSchema.description && (
              <p className="text-xs text-gray-500 mb-2">{propSchema.description}</p>
            )}
            <input
              type="text"
              value={value || ''}
              onChange={(e) => handleInputChange(fullPath, e.target.value)}
              className={`w-full border rounded-md px-3 py-2 ${error ? 'border-red-500' : 'border-gray-300'} focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
            {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
          </div>
        );
      }
    }

    if (propSchema.type === 'number' || propSchema.type === 'integer') {
      return (
        <div key={fullPath} className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {key}
            {jsonSchema.required?.includes(key) && <span className="text-red-500 ml-1">*</span>}
          </label>
          {propSchema.description && (
            <p className="text-xs text-gray-500 mb-2">{propSchema.description}</p>
          )}
          <input
            type="number"
            step={propSchema.type === 'integer' ? '1' : 'any'}
            value={value || ''}
            onChange={(e) => {
              const val = e.target.value === '' ? '' : propSchema.type === 'integer' ? parseInt(e.target.value) : parseFloat(e.target.value);
              handleInputChange(fullPath, val);
            }}
            className={`w-full border rounded-md px-3 py-2 ${error ? 'border-red-500' : 'border-gray-300'} focus:outline-none focus:ring-2 focus:ring-blue-500`}
          />
          {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
        </div>
      );
    }

    if (propSchema.type === 'boolean') {
      return (
        <div key={fullPath} className="mb-4">
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={value || false}
              onChange={(e) => handleInputChange(fullPath, e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label className="ml-2 block text-sm text-gray-700">
              {key}
              {jsonSchema.required?.includes(key) && <span className="text-red-500 ml-1">*</span>}
            </label>
          </div>
          {propSchema.description && (
            <p className="text-xs text-gray-500 mt-1">{propSchema.description}</p>
          )}
          {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
        </div>
      );
    }

    // For other types, show as text input with description
    return (
      <div key={fullPath} className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {key}
          {jsonSchema.required?.includes(key) && <span className="text-red-500 ml-1">*</span>}
          <span className="text-xs text-gray-500 ml-1">({propSchema.type})</span>
        </label>
        {propSchema.description && (
          <p className="text-xs text-gray-500 mb-2">{propSchema.description}</p>
        )}
        <input
          type="text"
          value={value || ''}
          onChange={(e) => handleInputChange(fullPath, e.target.value)}
          placeholder={t('tool.enterValue', { type: propSchema.type })}
          className={`w-full border rounded-md px-3 py-2 ${error ? 'border-red-500' : 'border-gray-300'} focus:outline-none focus:ring-2 focus:ring-blue-500`}
        />
        {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
      </div>
    );
  };

  if (!jsonSchema.properties) {
    return (
      <div className="p-4 bg-gray-50 rounded-md">
        <p className="text-sm text-gray-600">{t('tool.noParameters')}</p>
        <div className="flex justify-end space-x-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            {t('tool.cancel')}
          </button>
          <button
            onClick={() => onSubmit({})}
            disabled={loading}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? t('tool.running') : t('tool.runTool')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {Object.entries(jsonSchema.properties || {}).map(([key, propSchema]) =>
        renderField(key, propSchema)
      )}

      <div className="flex justify-end space-x-2 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200"
        >
          {t('tool.cancel')}
        </button>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? t('tool.running') : t('tool.runTool')}
        </button>
      </div>
    </form>
  );
};

export default DynamicForm;
