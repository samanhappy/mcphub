import { randomUUID } from 'node:crypto';

export const v4 = (): string => randomUUID();

const uuid = {
  v4,
};

export default uuid;
