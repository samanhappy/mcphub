import type { Request, Response } from 'express';
import { i18nMiddleware } from '../../src/middlewares/i18n.js';
import { missingCredentialError } from '../../src/services/credentialBindingService.js';
import { initI18n } from '../../src/utils/i18n.js';

beforeAll(async () => {
  await initI18n();
});

test('keeps the request language available to credential errors', async () => {
  const message = await new Promise<string>((resolve, reject) => {
    const req = {
      headers: { 'accept-language': 'zh-CN,zh;q=0.9' },
      query: {},
    } as unknown as Request;
    i18nMiddleware(req, {} as Response, () => {
      try {
        resolve(missingCredentialError('amap').message);
      } catch (error) {
        reject(error);
      }
    });
  });
  expect(message).toBe('服务器“amap”需要个人凭据。请在控制台 → 凭据中绑定所有必需字段。');
});
