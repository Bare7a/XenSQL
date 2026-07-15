export interface AppInfo {
  name: string;
  version: string;
  author: string;
  email: string;
  repository: string;
  description: string;
}

/** Fallback when Go binding is unavailable (dev in browser). */
export const DEFAULT_APP_INFO: AppInfo = {
  name: 'XenSQL',
  version: '1.3.8',
  author: 'Bare7a',
  email: 'bare7a@gmail.com',
  repository: 'https://github.com/Bare7a/XenSQL',
  description: 'A fast, native SQL client built with Go, Wails and React.',
};
