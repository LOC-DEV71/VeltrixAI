import {parseWebUrl} from './webUrl';

// A dedicated URL supports deploying Developer separately from the client.
// Older deployments without this key retain their existing client /developer page.
const appUrl = parseWebUrl(import.meta.env.VITE_APP_URL) || window.location.origin;
export const developerUrl = parseWebUrl(import.meta.env.VITE_DEVELOPER_URL) || new URL('/developer', appUrl).href;
