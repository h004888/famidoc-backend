import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';

export interface EncryptedPaymentSecret {
  keyId: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

@Injectable()
export class PaymentSettingsCrypto {
  private key() {
    const raw = process.env.PAYMENT_SETTINGS_ENCRYPTION_KEY ?? '';
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32 || key.toString('base64') !== raw)
      throw new ServiceUnavailableException('PAYMENT_SETTINGS_KEY_UNAVAILABLE');
    return key;
  }
  private keyId(key: Buffer) {
    return createHash('sha256').update(key).digest('hex').slice(0, 16);
  }
  encrypt(value: string): EncryptedPaymentSecret {
    const key = this.key(),
      iv = randomBytes(12),
      keyId = this.keyId(key);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(keyId));
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return {
      keyId,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }
  decrypt(value: EncryptedPaymentSecret): string {
    try {
      const key = this.key();
      if (value.keyId !== this.keyId(key)) throw new Error();
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(value.iv, 'base64'),
      );
      decipher.setAAD(Buffer.from(value.keyId));
      decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(value.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException('PAYMENT_SETTINGS_DECRYPT_FAILED');
    }
  }
  fingerprint(value: string) {
    return createHmac('sha256', this.key()).update(value).digest('hex');
  }
}
