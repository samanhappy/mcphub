/// <reference types="vite/client" />

interface ImportMeta {
  readonly env: {
    readonly PACKAGE_VERSION: string;
    // Add other custom env variables here if needed
    [key: string]: any;
  };
}
