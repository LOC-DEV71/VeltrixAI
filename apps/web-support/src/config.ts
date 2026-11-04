function webUrl(value: string | undefined) {
  try {
    const url = new URL(value?.trim() || '');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

const appUrl = webUrl(import.meta.env.VITE_APP_URL);
export const clientUrl = appUrl;
export const docsUrl = appUrl ? new URL('/docs', appUrl).href : null;
export const developerUrl = webUrl(import.meta.env.VITE_DEVELOPER_URL) || (appUrl ? new URL('/developer', appUrl).href : null);

// Reference paths come from the backend's product knowledge, never from model URLs.
export function clientReferenceUrl(path: unknown) {
  if (!appUrl || typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\\r\n]/.test(path)) return null;
  try {const url = new URL(path, appUrl); return url.origin === new URL(appUrl).origin ? url.href : null;} catch {return null;}
}

function contactUrl(value: string | undefined) {
  const httpUrl = webUrl(value);
  if (httpUrl) return httpUrl;
  try {
    const url = new URL(value?.trim() || '');
    return url.protocol === 'mailto:' && url.pathname.includes('@') ? url.href : null;
  } catch {
    return null;
  }
}

export const supportContactUrl = contactUrl(import.meta.env.VITE_SUPPORT_CONTACT_URL);

function apiUrl(value: string | undefined) {
  try {
    const url = new URL(value?.trim() || '/api', window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href.replace(/\/+$/, '') + '/support' : null;
  } catch {return null;}
}
export const supportApiUrl = apiUrl(import.meta.env.VITE_API_URL);
