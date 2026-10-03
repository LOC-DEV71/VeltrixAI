import { describe, it, expect } from 'vitest';
import { hashSecret, generateOpaqueToken, hmacToken } from '../src/utils/crypto';

describe('Crypto Utils', () => {
  it('should hash a secret consistently', () => {
    const secret = 'my-super-secret';
    const hash1 = hashSecret(secret);
    const hash2 = hashSecret(secret);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // sha256 hex is 64 chars
  });

  it('should generate random opaque tokens', () => {
    const token1 = generateOpaqueToken();
    const token2 = generateOpaqueToken();
    expect(token1).not.toBe(token2);
    expect(token1).toHaveLength(64);
  });

  it('should hmac a token consistently', () => {
    const data = 'some-data';
    const hmac1 = hmacToken(data, 'secret1');
    const hmac2 = hmacToken(data, 'secret1');
    const hmac3 = hmacToken(data, 'secret2');
    
    expect(hmac1).toBe(hmac2);
    expect(hmac1).not.toBe(hmac3);
  });
});
