import type { OpenAPIDeclaredSecurity, ServerFormData } from '../../frontend/src/types';
import {
  applyDeclaredSecurityPrefill,
  buildOpenApiSecurityNotice,
  isOpenApiSecurityUntouched,
} from '../../frontend/src/utils/openApiSecurityPrefill';

const formWithExplicitNone = (): ServerFormData => ({
  name: 'new-api',
  description: '',
  url: '',
  command: '',
  arguments: '',
  args: [],
  env: [],
  headers: [],
  openapi: {
    inputMode: 'url',
    url: 'https://example.com/openapi.json',
    schema: '',
    version: '3.1.0',
    securityType: 'none',
  },
});

const declaredBearer: OpenAPIDeclaredSecurity = {
  declared: true,
  supported: true,
  prefill: { type: 'http', http: { scheme: 'bearer' } },
  summary: 'HTTP bearer',
  alternatives: 1,
  requiresCredentials: true,
};

describe('OpenAPI security prefill user intent', () => {
  it('does not treat an explicit None selection as untouched', () => {
    const formData = formWithExplicitNone();

    expect(isOpenApiSecurityUntouched(formData, true)).toBe(false);
    expect(applyDeclaredSecurityPrefill(formData, declaredBearer, true)).toBe(formData);
  });

  it('warns when the user explicitly keeps None against a declared scheme', () => {
    const notice = buildOpenApiSecurityNotice(formWithExplicitNone(), declaredBearer, {
      includeNotDeclared: true,
      securityTouched: true,
    });

    expect(notice).toEqual({
      kind: 'warning',
      messageKey: 'securityMismatchWarning',
      values: {
        summary: 'HTTP bearer',
        configured: 'none',
      },
    });
  });
});
