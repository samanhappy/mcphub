import fs from 'fs';
import path from 'path';

describe('server visibility locale strings', () => {
  it('provides sharing labels in every supported locale', () => {
    for (const locale of ['en', 'fr', 'tr', 'zh']) {
      const localePath = path.join(process.cwd(), 'locales', `${locale}.json`);
      const translations = JSON.parse(fs.readFileSync(localePath, 'utf8'));

      expect(translations.server.visibilityGroupShort).toBeTruthy();
      expect(translations.server.visibilityGroup).toBeTruthy();
      expect(translations.server.shareWithUsers).toBeTruthy();
      expect(translations.server.shareWithUsersDescription).toBeTruthy();
      expect(translations.server.shareCandidatesLoading).toBeTruthy();
      expect(translations.server.shareCandidatesError).toBeTruthy();
      expect(translations.server.shareAfterCreate).toBeTruthy();
      expect(translations.server.noShareCandidates).toBeTruthy();
    }
  });

  it('provides Chinese translations for sharing labels and help text', () => {
    const localePath = path.join(process.cwd(), 'locales', 'zh.json');
    const zh = JSON.parse(fs.readFileSync(localePath, 'utf8'));

    expect(zh.server.visibility).toBe('可见性');
    expect(zh.server.visibilityPrivateShort).toBe('私有');
    expect(zh.server.visibilityPrivate).toBe('私有 — 仅所有者和管理员可见');
    expect(zh.server.visibilityGroupShort).toBe('共享');
    expect(zh.server.visibilityGroup).toBe('共享 — 仅选中的用户可见');
    expect(zh.server.visibilityPublicShort).toBe('公开');
    expect(zh.server.visibilityPublic).toBe('公开 — 所有已登录用户可见');
    expect(zh.server.visibilityDescription).toBe(
      '控制哪些非管理员用户可以发现并调用此服务器。管理员始终拥有访问权限。',
    );
  });
});
