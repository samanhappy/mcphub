import fs from 'fs';
import path from 'path';

describe('server visibility locale strings', () => {
  it('provides Chinese translations for visibility labels and help text', () => {
    const localePath = path.join(process.cwd(), 'locales', 'zh.json');
    const zh = JSON.parse(fs.readFileSync(localePath, 'utf8'));

    expect(zh.server.visibility).toBe('可见性');
    expect(zh.server.visibilityPrivate).toBe('私有 — 仅所有者和管理员可见');
    expect(zh.server.visibilityPublic).toBe('公开 — 所有已登录用户可见');
    expect(zh.server.visibilityDescription).toBe(
      '控制哪些非管理员用户可以在 tools/list 中看到此服务器。管理员始终可见所有服务器，不受此设置影响。',
    );
  });
});
