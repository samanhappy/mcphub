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
  title?: string; // Optional title to display instead of default parameters title
}

const DynamicForm: React.FC<DynamicFormProps> = ({ schema, onSubmit, onCancel, loading = false, storageKey, title }) => {
  const { t } = useTranslation();
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isJsonMode, setIsJsonMode] = useState<boolean>(false);
  const [jsonText, setJsonText] = useState<string>('');
  const [jsonError, setJsonError] = useState<string>('');

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
            // For objects with properties, recursively initialize
            if (propSchema.properties) {
              values[key] = initializeValues(propSchema, fullPath);
            } else {
              // For objects without properties, initialize as empty object
              values[key] = {};
            }
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

  // Sync JSON text with form values when switching modes
  useEffect(() => {
    if (isJsonMode && Object.keys(formValues).length > 0) {
      setJsonText(JSON.stringify(formValues, null, 2));
      setJsonError('');
    }
  }, [isJsonMode, formValues]);

  const handleJsonTextChange = (text: string) => {
    setJsonText(text);
    setJsonError('');

    try {
      const parsedJson = JSON.parse(text);
      setFormValues(parsedJson);

      // Save to localStorage if storageKey is provided
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(parsedJson));
        } catch (error) {
          console.warn('Failed to save form data to localStorage:', error);
        }
      }
    } catch (error) {
      setJsonError(t('tool.invalidJsonFormat'));
    }
  };

  const switchToJsonMode = () => {
    setJsonText(JSON.stringify(formValues, null, 2));
    setJsonError('');
    setIsJsonMode(true);
  };

  const switchToFormMode = () => {
    // Validate JSON before switching
    if (jsonText.trim()) {
      try {
        const parsedJson = JSON.parse(jsonText);
        setFormValues(parsedJson);
        setJsonError('');
        setIsJsonMode(false);
      } catch (error) {
        setJsonError(t('tool.fixJsonBeforeSwitching'));
        return;
      }
    } else {
      setIsJsonMode(false);
    }
  };

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
          const value = getNestedValue(values, fullPath);

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
            } else if (propSchema.type === 'array' && Array.isArray(value)) {
              // Validate array items
              if (propSchema.items) {
                value.forEach((item: any, index: number) => {
                  if (propSchema.items?.type === 'object' && propSchema.items.properties) {
                    validateObject(propSchema.items, item, `${fullPath}.${index}`);
                  }
                });
              }
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

  const getNestedValue = (obj: any, path: string): any => {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  };

  const renderObjectField = (key: string, schema: JsonSchema, currentValue: any, onChange: (value: any) => void): React.ReactNode => {
    const value = currentValue?.[key];

    if (schema.type === 'string') {
      if (schema.enum) {
        return (
          <select
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full border rounded-md px-2 py-1 text-sm border-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">{t('tool.selectOption')}</option>
            {schema.enum.map((option: any, idx: number) => (
              <option key={idx} value={option}>
                {option}
              </option>
            ))}
          </select>
        );
      } else {
        return (
          <input
            type="text"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full border rounded-md px-2 py-1 text-sm border-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500 form-input"
            placeholder={schema.description || t('tool.enterKey', { key })}
          />
        );
      }
    }

    if (schema.type === 'number' || schema.type === 'integer') {
      return (
        <input
          type="number"
          step={schema.type === 'integer' ? '1' : 'any'}
          value={value || ''}
          onChange={(e) => {
            const val = e.target.value === '' ? '' : schema.type === 'integer' ? parseInt(e.target.value) : parseFloat(e.target.value);
            onChange(val);
          }}
          className="w-full border rounded-md px-2 py-1 text-sm border-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500 form-input"
        />
      );
    }

    if (schema.type === 'boolean') {
      return (
        <input
          type="checkbox"
          checked={value || false}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
        />
      );
    }

    // Default to text input
    return (
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border rounded-md px-2 py-1 text-sm border-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500 form-input"
        placeholder={schema.description || t('tool.enterKey', { key })}
      />
    );
  };

  const renderField = (key: string, propSchema: JsonSchema, path: string = ''): React.ReactNode => {
    const fullPath = path ? `${path}.${key}` : key;
    const value = getNestedValue(formValues, fullPath);
    const error = errors[fullPath];    // Handle array type
    if (propSchema.type === 'array') {
      const arrayValue = getNestedValue(formValues, fullPath) || [];

      return (
        <div key={fullPath} className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {key}
            {(path ? getNestedValue(jsonSchema, path)?.required?.includes(key) : jsonSchema.required?.includes(key)) && <span className="text-status-red ml-1">*</span>}
          </label>
          {propSchema.description && (
            <p className="text-xs text-gray-500 mb-2">{propSchema.description}</p>
          )}

          <div className="border border-gray-200 rounded-md p-3 bg-gray-50">
            {arrayValue.map((item: any, index: number) => (
              <div key={index} className="mb-3 p-3 bg-white border rounded-md">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium text-gray-600">{t('tool.item', { index: index + 1 })}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const newArray = [...arrayValue];
                      newArray.splice(index, 1);
                      handleInputChange(fullPath, newArray);
                    }}
                    className="text-status-red hover:text-red-700 text-sm"
                  >
                    {t('common.remove')}
                  </button>
                </div>

                {propSchema.items?.type === 'string' && propSchema.items.enum ? (
                  <select
                    value={item || ''}
                    onChange={(e) => {
                      const newArray = [...arrayValue];
                      newArray[index] = e.target.value;
                      handleInputChange(fullPath, newArray);
                    }}
                    className="w-full border rounded-md px-3 py-2 border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">{t('tool.selectOption')}</option>
                    {propSchema.items.enum.map((option: any, idx: number) => (
                      <option key={idx} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : propSchema.items?.type === 'object' && propSchema.items.properties ? (
                  <div className="space-y-3">
                    {Object.entries(propSchema.items.properties).map(([objKey, objSchema]) => (
                      <div key={objKey}>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          {objKey}
                          {propSchema.items?.required?.includes(objKey) && <span className="text-status-red ml-1">*</span>}
                        </label>
                        {renderObjectField(objKey, objSchema as JsonSchema, item, (newValue) => {
                          const newArray = [...arrayValue];
                          newArray[index] = { ...newArray[index], [objKey]: newValue };
                          handleInputChange(fullPath, newArray);
                        })}
                      </div>
                    ))}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={item || ''}
                    onChange={(e) => {
                      const newArray = [...arrayValue];
                      newArray[index] = e.target.value;
                      handleInputChange(fullPath, newArray);
                    }}
                    className="w-full border rounded-md px-3 py-2 border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 form-input"
                    placeholder={t('tool.enterValue', { type: propSchema.items?.type || 'value' })}
                  />
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={() => {
                const newItem = propSchema.items?.type === 'object' ? {} : '';
                handleInputChange(fullPath, [...arrayValue, newItem]);
              }}
              className="w-full mt-2 px-3 py-2 text-sm text-blue-600 border border-blue-300 rounded-md hover:bg-blue-50"
            >
              {t('tool.addItem', { key })}
            </button>
          </div>

          {error && <p className="text-status-red text-xs mt-1">{error}</p>}
        </div>
      );
    }    // Handle object type
    if (propSchema.type === 'object') {
      if (propSchema.properties) {
        // Object with defined properties - render as nested form
        return (
          <div key={fullPath} className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {key}
              {(path ? getNestedValue(jsonSchema, path)?.required?.includes(key) : jsonSchema.required?.includes(key)) && <span className="text-status-red ml-1">*</span>}
            </label>
            {propSchema.description && (
              <p className="text-xs text-gray-500 mb-2">{propSchema.description}</p>
            )}

            <div className="border border-gray-200 rounded-md p-4 bg-gray-50">
              {Object.entries(propSchema.properties).map(([objKey, objSchema]) => (
                renderField(objKey, objSchema as JsonSchema, fullPath)
              ))}
            </div>

            {error && <p className="text-status-red text-xs mt-1">{error}</p>}
          </div>
        );
      } else {
        // Object without defined properties - render as JSON textarea
        return (
          <div key={fullPath} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {key}
              {(path ? getNestedValue(jsonSchema, path)?.required?.includes(key) : jsonSchema.required?.includes(key)) && <span className="text-status-red ml-1">*</span>}
              <span className="text-xs text-gray-500 ml-1">(JSON object)</span>
            </label>
            {propSchema.description && (
              <p className="text-xs text-gray-500 mb-2">{propSchema.description}</p>
            )}
            <textarea
              value={typeof value === 'object' ? JSON.stringify(value, null, 2) : value || '{}'}
              onChange={(e) => {
                try {
                  const parsedValue = JSON.parse(e.target.value);
                  handleInputChange(fullPath, parsedValue);
                } catch (err) {
                  // Keep the string value if it's not valid JSON yet
                  handleInputChange(fullPath, e.target.value);
                }
              }}
              placeholder={`{\n  "key": "value"\n}`}
              className={`w-full border rounded-md px-3 py-2 font-mono text-sm ${error ? 'border-red-500' : 'border-gray-300'} focus:outline-none focus:ring-2 focus:ring-blue-500`}
              rows={4}
            />
            {error && <p className="text-status-red text-xs mt-1">{error}</p>}
          </div>
        );
      }
    } if (propSchema.type === 'string') {
      if (propSchema.enum) {
        return (
          <div key={fullPath} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {key}
              {(path ? false : jsonSchema.required?.includes(key)) && <span className="text-status-red ml-1">*</span>}
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
            {error && <p className="text-status-red text-xs mt-1">{error}</p>}
          </div>
        );
      } else {
        return (
          <div key={fullPath} className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {key}
              {(path ? false : jsonSchema.required?.includes(key)) && <span className="text-status-red ml-1">*</span>}
            </label>
            {propSchema.description && (
              <p className="text-xs text-gray-500 mb-2">{propSchema.description}</p>
            )}
            <input
              type="text"
              value={value || ''}
              onChange={(e) => handleInputChange(fullPath, e.target.value)}
              className={`w-full border rounded-md px-3 py-2 ${error ? 'border-red' : 'border-gray-200'} focus:outline-none form-input`}
            />
            {error && <p className="text-status-red text-xs mt-1">{error}</p>}
          </div>
        );
      }
    } if (propSchema.type === 'number' || propSchema.type === 'integer') {
      return (
        <div key={fullPath} className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {key}
            {(path ? false : jsonSchema.required?.includes(key)) && <span className="text-status-red ml-1">*</span>}
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
            className={`w-full border rounded-md px-3 py-2 form-input ${error ? 'border-red-500' : 'border-gray-300'} focus:outline-none focus:ring-2 focus:ring-blue-500`}
          />
          {error && <p className="text-status-red text-xs mt-1">{error}</p>}
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
              {(path ? false : jsonSchema.required?.includes(key)) && <span className="text-status-red ml-1">*</span>}
            </label>
          </div>
          {propSchema.description && (
            <p className="text-xs text-gray-500 mt-1">{propSchema.description}</p>
          )}
          {error && <p className="text-status-red text-xs mt-1">{error}</p>}
        </div>
      );
    }    // For other types, show as text input with description
    return (
      <div key={fullPath} className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {key}
          {(path ? false : jsonSchema.required?.includes(key)) && <span className="text-status-red ml-1">*</span>}
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
          className={`w-full border rounded-md px-3 py-2 ${error ? 'border-red-500' : 'border-gray-300'} focus:outline-none focus:ring-2 focus:ring-blue-500 form-input`}
        />
        {error && <p className="text-status-red text-xs mt-1">{error}</p>}
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
    <div className="space-y-4">
      {/* Mode Toggle */}
      <div className="flex justify-between items-center pb-3">
        <h6 className="text-md font-medium text-gray-900">{title}</h6>
        <div className="flex space-x-2">
          <button
            type="button"
            onClick={switchToFormMode}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${!isJsonMode
              ? 'bg-blue-100 text-blue-800 rounded hover:bg-blue-200 text-sm btn-primary'
              : 'text-sm text-gray-600 bg-gray-200 rounded hover:bg-gray-300 btn-secondary'
              }`}
          >
            {t('tool.formMode')}
          </button>
          <button
            type="button"
            onClick={switchToJsonMode}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${isJsonMode
              ? 'px-4 py-1 bg-blue-100 text-blue-800 rounded hover:bg-blue-200 text-sm btn-primary'
              : 'text-sm text-gray-600 bg-gray-200 rounded hover:bg-gray-300 btn-secondary'
              }`}
          >
            {t('tool.jsonMode')}
          </button>
        </div>
      </div>

      {/* JSON Mode */}
      {isJsonMode ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('tool.jsonConfiguration')}
            </label>
            <textarea
              value={jsonText}
              onChange={(e) => handleJsonTextChange(e.target.value)}
              placeholder={`{\n  "key": "value"\n}`}
              className={`w-full h-64 border rounded-md px-3 py-2 font-mono text-sm resize-y form-input ${jsonError ? 'border-red-500' : 'border-gray-300'
                } focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
            {jsonError && <p className="text-status-red text-xs mt-1">{jsonError}</p>}
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-1 text-sm text-gray-600 bg-gray-200 rounded hover:bg-gray-300 btn-secondary"
            >
              {t('tool.cancel')}
            </button>
            <button
              onClick={() => {
                try {
                  const parsedJson = JSON.parse(jsonText);
                  onSubmit(parsedJson);
                } catch (error) {
                  setJsonError(t('tool.invalidJsonFormat'));
                }
              }}
              disabled={loading || !!jsonError}
              className="px-4 py-1 bg-blue-100 text-blue-800 rounded hover:bg-blue-200 text-sm btn-primary"
            >
              {loading ? t('tool.running') : t('tool.runTool')}
            </button>
          </div>
        </div>
      ) : (
        /* Form Mode */
        <form onSubmit={handleSubmit} className="space-y-4">
          {Object.entries(jsonSchema.properties || {}).map(([key, propSchema]) =>
            renderField(key, propSchema)
          )}

          <div className="flex justify-end space-x-2 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-1 text-sm text-gray-600 bg-gray-200 rounded hover:bg-gray-300 btn-secondary"
            >
              {t('tool.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1 bg-blue-100 text-blue-800 rounded hover:bg-blue-200 text-sm btn-primary"
            >
              {loading ? t('tool.running') : t('tool.runTool')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default DynamicForm;
