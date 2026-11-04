import {supportUrl} from './supportUrl';
import {validateSupportReturn} from './supportReturnPolicy';

// Only the Support deployment configured in env may receive the browser after login.
// No access/refresh token is ever attached to this URL.
export function allowedSupportReturn(value: unknown): string | null {
  return validateSupportReturn(value, supportUrl);
}
