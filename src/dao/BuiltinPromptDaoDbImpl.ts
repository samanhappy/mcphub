import { BuiltinPromptDaoImpl } from './BuiltinPromptDao.js';

/**
 * Database-backed BuiltinPrompt DAO implementation.
 * Currently delegates to the JSON file implementation.
 * A full TypeORM entity can be added when DB migration support is needed.
 */
export class BuiltinPromptDaoDbImpl extends BuiltinPromptDaoImpl {}
