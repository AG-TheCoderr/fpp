/** True when running as an installed PWA or already in native fullscreen. */
export function isStandaloneDisplay(): boolean {
  const mm =
    typeof window.matchMedia === 'function' &&
    (window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches);
  const iosStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return mm || iosStandalone || isDocumentFullscreen();
}

export function isDocumentFullscreen(): boolean {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return !!(document.fullscreenElement || doc.webkitFullscreenElement);
}

/**
 * Enter OS fullscreen (hides browser chrome). Must run from a user gesture.
 * Also tries landscape lock on phones so the parkour FOV isn't letterboxed.
 */
export function requestAppFullscreen(): void {
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  if (isDocumentFullscreen()) return;

  const go = el.requestFullscreen
    ? el.requestFullscreen({ navigationUI: 'hide' })
    : el.webkitRequestFullscreen?.();

  Promise.resolve(go).catch(() => undefined);

  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (mode: string) => Promise<void>;
  };
  orientation.lock?.('landscape').catch(() => undefined);
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  const ready = () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  };
  if (document.readyState === 'complete') ready();
  else window.addEventListener('load', ready, { once: true });
}
