/// <reference types="vite/client" />

interface ImportMeta {
  readonly env: {
    readonly PACKAGE_VERSION: string;
    readonly VITE_BASE_PATH?: string; // Add base path environment variable
    // Add other custom env variables here if needed
    [key: string]: any;
  };
}
