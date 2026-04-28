import { AsyncLocalStorage } from 'node:async_hooks';
import { IUser } from '../types/index.js';

export class UserContextService {
  private static instance: UserContextService;
  private readonly asyncLocalStorage = new AsyncLocalStorage<IUser | null>();

  private constructor() {}

  static getInstance(): UserContextService {
    if (!UserContextService.instance) {
      UserContextService.instance = new UserContextService();
    }
    return UserContextService.instance;
  }

  getCurrentUser(): IUser | null {
    return this.asyncLocalStorage.getStore() ?? null;
  }

  setCurrentUser(user: IUser): void {
    this.asyncLocalStorage.enterWith(user);
  }

  clearCurrentUser(): void {
    this.asyncLocalStorage.enterWith(null);
  }

  isAdmin(): boolean {
    const user = this.getCurrentUser();
    return user?.isAdmin || false;
  }

  hasUser(): boolean {
    return this.getCurrentUser() !== null;
  }
}
