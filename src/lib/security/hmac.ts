/**
 * HMAC Signature Utilities
 * For webhook authentication between platform and external plugins
 */

import crypto from 'crypto';

export class HMACVerifier {
  /**
   * Genera signature HMAC-SHA256
   */
  static generateSignature(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  /**
   * Verifica signature HMAC usando timing-safe comparison
   */
  static verifySignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean {
    const expected = this.generateSignature(payload, secret);

    // Timing-safe comparison to prevent timing attacks
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      );
    } catch {
      // Buffers have different lengths or invalid format
      return false;
    }
  }

  /**
   * Estrae signature da header X-Plugin-Signature
   * Format: "sha256=<hash>"
   */
  static extractSignature(header: string | null): string | null {
    if (!header) return null;

    // Expected format: "sha256=abc123..."
    const match = header.match(/^sha256=([a-f0-9]{64})$/);
    return match ? match[1] : null;
  }

  /**
   * Genera header signature per webhook calls
   */
  static createSignatureHeader(payload: string, secret: string): string {
    const signature = this.generateSignature(payload, secret);
    return `sha256=${signature}`;
  }
}
