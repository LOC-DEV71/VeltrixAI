export function validateSupportReturn(value: unknown, configuredUrl: string | null): string | null {
  if (!configuredUrl || typeof value !== 'string' || value.length > 2048 || value.includes('\\')) return null;
  try {
    const configured = new URL(configuredUrl);
    const target = new URL(value);
    const rootPath = configured.pathname.replace(/\/+$/, '') || '/';
    if (!['http:', 'https:'].includes(configured.protocol) || target.origin !== configured.origin || target.username || target.password) return null;
    if (rootPath !== '/' && target.pathname !== rootPath && !target.pathname.startsWith(rootPath + '/')) return null;
    return target.href;
  } catch {return null;}
}
