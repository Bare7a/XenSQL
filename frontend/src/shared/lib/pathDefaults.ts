export interface PathDefaults {
  platform: string;
  separator: string;
  sshKey?: string;
  sshKnownHosts?: string;
}

/** Fallback when the Go binding is unavailable (dev in browser). */
export const DEFAULT_PATH_DEFAULTS: PathDefaults = {
  platform: '',
  separator: '/',
  sshKey: '~/.ssh/id_ed25519',
  sshKnownHosts: '~/.ssh/known_hosts',
};

export function isWindows(defaults: PathDefaults): boolean {
  return defaults.platform === 'windows';
}
