export interface SkillPublication {
  enabled: boolean;
  global: boolean;
  groupIds: string[];
}

export type HostedSkillSource =
  | { type: 'directory'; name: string }
  | { type: 'github'; url: string; commit: string };

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
