// Blank/invalid configuration keeps support links hidden. Deployment supplies
// the independent support application's URL; never assume an internal route.
import {parseWebUrl} from './webUrl';
export {parseWebUrl as parseSupportUrl} from './webUrl';
export const supportUrl = parseWebUrl(import.meta.env.VITE_SUPPORT_URL);
