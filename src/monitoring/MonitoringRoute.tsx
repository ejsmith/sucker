import { usePathname } from 'expo-router';
import { useEffect } from 'react';
import { setMonitoringRoute } from './exceptionless';

export function MonitoringRoute() {
  const pathname = usePathname();

  useEffect(() => {
    setMonitoringRoute(pathname);
  }, [pathname]);

  return null;
}
