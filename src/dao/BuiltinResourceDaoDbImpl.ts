import { BuiltinResourceDaoImpl } from './BuiltinResourceDao.js';

/**
 * Database-backed BuiltinResource DAO implementation.
 * Currently delegates to the JSON file implementation.
 * A full TypeORM entity can be added when DB migration support is needed.
 */
export class BuiltinResourceDaoDbImpl extends BuiltinResourceDaoImpl {}
