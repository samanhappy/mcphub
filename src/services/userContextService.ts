import { IUser } from '../types/index.js';

// User context storage
class UserContext {
  private static instance: UserContext;
  private currentUser: IUser | null = null;

  static getInstance(): UserContext {
    if (!UserContext.instance) {
      UserContext.instance = new UserContext();
    }
    return UserContext.instance;
  }

  setUser(user: IUser): void {
    this.currentUser = user;
  }

  getUser(): IUser | null {
    return this.currentUser;
  }

  clearUser(): void {
    this.currentUser = null;
  }
}

export class UserContextService {
  private static instance: UserContextService;
  private userContext = UserContext.getInstance();

  static getInstance(): UserContextService {
    if (!UserContextService.instance) {
      UserContextService.instance = new UserContextService();
    }
    return UserContextService.instance;
  }

  getCurrentUser(): IUser | null {
    return this.userContext.getUser();
  }

  setCurrentUser(user: IUser): void {
    this.userContext.setUser(user);
  }

  clearCurrentUser(): void {
    this.userContext.clearUser();
  }

  isAdmin(): boolean {
    const user = this.getCurrentUser();
    return user?.isAdmin || false;
  }

  hasUser(): boolean {
    return this.getCurrentUser() !== null;
  }
}
