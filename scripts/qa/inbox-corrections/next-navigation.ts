import { useSyncExternalStore } from 'react';
const subscribe = (cb: () => void) => { window.addEventListener('popstate', cb); return () => window.removeEventListener('popstate', cb); };
export const useSearchParams = () => new URLSearchParams(useSyncExternalStore(subscribe, () => location.search));
export const usePathname = () => location.pathname;
export const useRouter = () => ({ replace: (url: string) => { history.replaceState(null, '', url); window.dispatchEvent(new PopStateEvent('popstate')); }, push: (url: string) => { history.pushState(null, '', url); window.dispatchEvent(new PopStateEvent('popstate')); } });
