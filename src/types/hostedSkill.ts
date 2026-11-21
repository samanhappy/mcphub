export interface SkillPublication {
  enabled: boolean;
  global: boolean;
  groupIds: string[];
}

export type HostedSkillSource =
  | { type: 'directory'; name: string }
  | { type: 'github' | 'skills-sh'; url: string; commit: string };

export interface SkillSearchResult {
  name: string;
  source: string;
  url: string;
  installs: number | null;
}

export interface SkillFile {
  path: string;
  uri: string;
  digest: string;
  size: number;
}

export interface SkillEntry {
  uri: string;
  frontmatter: Record<string, unknown> & { name: string; description: string };
  resources: Array<Omit<SkillFile, 'path'>>;
}

export interface HostedSkill extends SkillPublication {
  id: string;
  name: string;
  description: string;
  source: HostedSkillSource;
  version: string;
  files: SkillFile[];
}

export const MAX_SKILL_PREVIEW_BYTES = 512 * 1024;

export type SkillPreview =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mimeType: 'image/png' | 'image/jpeg'; base64: string }
  | { kind: 'binary' | 'too-large' };
