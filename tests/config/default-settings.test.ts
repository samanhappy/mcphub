import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../..');

describe('default settings files', () => {
  it('keeps admin/admin123 in the repository settings for local development', async () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'mcp_settings.json'), 'utf8'),
    );

    expect(settings.users).toHaveLength(1);
    expect(settings.users[0].username).toBe('admin');
    expect(settings.users[0].isAdmin).toBe(true);
    expect(settings.users[0].password).not.toBe('admin123');
    await expect(bcrypt.compare('admin123', settings.users[0].password)).resolves.toBe(true);
  });

  it('keeps Docker defaults free of pre-seeded users', () => {
    const dockerSettings = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'mcp_settings.docker.json'), 'utf8'),
    );

    expect(Array.isArray(dockerSettings.users)).toBe(true);
    expect(dockerSettings.users).toHaveLength(0);
  });

  it('prevents the local settings file from entering the Docker build context', () => {
    const dockerignore = fs.readFileSync(path.join(projectRoot, '.dockerignore'), 'utf8');
    const dockerfile = fs.readFileSync(path.join(projectRoot, 'Dockerfile'), 'utf8');

    expect(dockerignore.split(/\r?\n/)).toContain('mcp_settings.json');
    expect(dockerfile).toContain('COPY mcp_settings.docker.json ./mcp_settings.json');
  });
});
