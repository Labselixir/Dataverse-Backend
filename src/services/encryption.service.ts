import CryptoJS from 'crypto-js';
import { ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

export class EncryptionService {
  private encryptionKey: string;

  constructor() {
    if (!process.env.ENCRYPTION_KEY) {
      throw new Error('Encryption key not configured');
    }
    
    if (process.env.ENCRYPTION_KEY.length < 32) {
      throw new Error('Encryption key must be at least 32 characters');
    }
    
    this.encryptionKey = process.env.ENCRYPTION_KEY;
  }

  encrypt(text: string): string {
    try {
      const encrypted = CryptoJS.AES.encrypt(text, this.encryptionKey).toString();
      return encrypted;
    } catch (error) {
      logger.error('Encryption failed:', error);
      throw new ValidationError('Failed to encrypt data');
    }
  }

  decrypt(encryptedText: string): string {
    try {
      const decrypted = CryptoJS.AES.decrypt(encryptedText, this.encryptionKey);
      const originalText = decrypted.toString(CryptoJS.enc.Utf8);
      
      if (!originalText) {
        throw new Error('Decryption resulted in empty string');
      }
      
      return originalText;
    } catch (error) {
      logger.error('Decryption failed:', error);
      throw new ValidationError('Failed to decrypt data');
    }
  }

  hash(text: string): string {
    return CryptoJS.SHA256(text).toString();
  }

  generateRandomKey(length: number = 32): string {
    const randomBytes = CryptoJS.lib.WordArray.random(length);
    return randomBytes.toString();
  }

  compareHash(text: string, hash: string): boolean {
    const textHash = this.hash(text);
    return textHash === hash;
  }
}