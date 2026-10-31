import { AsyncLocalStorage } from 'node:async_hooks';
import type { DataSource, QueryRunner } from 'typeorm';

export const databaseTransaction = new AsyncLocalStorage<QueryRunner>();

// Existing DAOs keep their interfaces; an API mutation uses one transaction across them.
export const scopedDataSource = (source: DataSource): DataSource => {
  const runner = databaseTransaction.getStore();
  if (!runner?.isTransactionActive) return source;
  return new Proxy(source, {
    get(target, property) {
      if (property === 'manager') return runner.manager;
      if (
        ['getRepository', 'query', 'transaction', 'createQueryBuilder'].includes(String(property))
      ) {
        const method = Reflect.get(runner.manager, property);
        return method.bind(runner.manager);
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
};
