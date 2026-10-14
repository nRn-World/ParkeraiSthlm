// Användningsstatistik via Umami (laddas i index.html). Inga cookies, inga personuppgifter
// och inget som får störa appen: saknas skriptet – offline, avstängt eller på localhost –
// blir anropet en tyst no-op.
type UmamiTracker = {
  track: (event: string | Record<string, unknown>, data?: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    umami?: UmamiTracker;
  }
}

export function trackEvent(name: string, data?: Record<string, unknown>) {
  try {
    if (!navigator.onLine) return;
    window.umami?.track(name, data);
  } catch {
    // Statistiken är valfri – ett misslyckat anrop ska aldrig påverka appen.
  }
}
