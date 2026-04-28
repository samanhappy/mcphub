import { AsyncLocalStorage } from 'node:async_hooks';
import { IUser } from '../types/index.js';

export class UserContextService {
  private static instance: UserContextService;
  private readonly asyncLocalStorage = new AsyncLocalStorage<{ currentUser: IUser | null }>();

  private constructor() {}

  static getInstance(): UserContextService {
    if (!UserContextService.instance) {
      UserContextService.instance = new UserContextService();
    }
    return UserContextService.instance;
  }

  getCurrentUser(): IUser | null {
    return this.asyncLocalStorage.getStore()?.currentUser ?? null;
  }

  setCurrentUser(user: IUser): void {
    const store = this.asyncLocalStorage.getStore();
    if (store) {
      store.currentUser = user;
      return;
    }

    this.asyncLocalStorage.enterWith({ currentUser: user });
  }

  clearCurrentUser(): void {
    const store = this.asyncLocalStorage.getStore();
    if (store) {
      store.currentUser = null;
      return;
    }

    this.asyncLocalStorage.enterWith({ currentUser: null });
  }

  runWithContext<T>(callback: () => T, initialUser: IUser | null = null): T {
    return this.asyncLocalStorage.run({ currentUser: initialUser }, callback);
  }

  isAdmin(): boolean {
    const user = this.getCurrentUser();
    return user?.isAdmin || false;
  }

  hasUser(): boolean {
    return this.getCurrentUser() !== null;
  }
}
