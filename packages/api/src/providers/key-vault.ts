import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { HttpError } from '../errors';

export class KeyVault {
  private key: Buffer;

  constructor(encoded: string | undefined) {
    if (!encoded || !/^[0-9a-f]{64}$/i.test(encoded)) {
      throw new HttpError(
        503,
        'byok_unavailable',
        'Personal AI keys are not configured on this server.',
      );
    }
    this.key = Buffer.from(encoded, 'hex');
  }

  encrypt(value: string, ownerId: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(ownerId));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(value: string, ownerId: string): string {
    const [version, iv, tag, ciphertext] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Invalid encrypted key.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(ownerId));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
