// Utility function to detect ${} variables in server configurations
export const detectVariables = (payload: any): string[] => {
  const variables = new Set<string>();
  const variableRegex = /\$\{([^}]+)\}/g;

  const checkString = (str: string) => {
    let match;
    while ((match = variableRegex.exec(str)) !== null) {
      variables.add(match[1]);
    }
  };

  const checkObject = (obj: any, path: string = '') => {
    if (typeof obj === 'string') {
      checkString(obj);
    } else if (Array.isArray(obj)) {
      obj.forEach((item, index) => checkObject(item, `${path}[${index}]`));
    } else if (obj && typeof obj === 'object') {
      Object.entries(obj).forEach(([key, value]) => {
        checkObject(value, path ? `${path}.${key}` : key);
      });
    }
  };

  checkObject(payload);
  return Array.from(variables);
};
