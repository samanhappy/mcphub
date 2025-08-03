// Custom types for Express Request
export interface I18nRequest extends Request {
  language?: string;
  t: (key: string, options?: any) => string;
}
