import { useEffect, useState } from 'react';
import { api } from '@/shared/lib/api';
import { DEFAULT_APP_INFO, type AppInfo } from '@/shared/lib/appInfo';

export function useAppInfo(): AppInfo {
  const [info, setInfo] = useState<AppInfo>(DEFAULT_APP_INFO);
  useEffect(() => {
    void api
      .getAppInfo()
      .then(setInfo)
      .catch(() => setInfo(DEFAULT_APP_INFO));
  }, []);
  return info;
}
