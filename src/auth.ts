import { CONFIG } from './config';

let tokenClient: any = null;
let accessToken: string | null = null;
let tokenExpiry = 0; // epoch ms

const loaded = new Map<string, Promise<void>>();

export function loadScript(src: string): Promise<void> {
  if (!loaded.has(src)) {
    loaded.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(s);
      }),
    );
  }
  return loaded.get(src)!;
}

export async function initAuth(): Promise<void> {
  await loadScript('https://accounts.google.com/gsi/client');
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: () => {}, // replaced per-request in getToken()
  });
}

/**
 * Returns a valid access token, prompting the user only when needed.
 * Tokens live ~1h; we refresh 5 minutes early. GIS reuses the existing
 * Google session, so silent renewals do not show UI.
 */
export function getToken(interactive = true): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry - 5 * 60_000) {
    return Promise.resolve(accessToken);
  }
  return new Promise((resolve, reject) => {
    tokenClient.callback = (resp: any) => {
      if (resp.error) {
        reject(new Error(`Auth failed: ${resp.error}`));
        return;
      }
      accessToken = resp.access_token;
      tokenExpiry = Date.now() + Number(resp.expires_in) * 1000;
      resolve(accessToken!);
    };
    tokenClient.error_callback = (err: any) => {
      reject(new Error(`Auth failed: ${err?.type ?? 'popup error'}`));
    };
    // '' lets Google decide: shows consent on first use, silent after.
    tokenClient.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}

export function hasToken(): boolean {
  return accessToken !== null && Date.now() < tokenExpiry;
}

export function currentToken(): string | null {
  return hasToken() ? accessToken : null;
}

export function signOut(): void {
  if (accessToken) {
    try {
      google.accounts.oauth2.revoke(accessToken, () => {});
    } catch {
      /* revoke is best-effort */
    }
  }
  accessToken = null;
  tokenExpiry = 0;
}

/** Fetch the signed-in user's email via the Drive about endpoint. */
export async function fetchUserEmail(token: string): Promise<string> {
  const r = await fetch(
    'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) return '';
  const j = await r.json();
  return j.user?.emailAddress ?? '';
}
