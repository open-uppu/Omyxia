/**
 * TOTP (Time-based One-Time Password) Implementation per RFC 6238
 * 
 * This is a pure TypeScript implementation using Node.js crypto module only.
 * No third-party dependencies (otplib, speakeasy) for security review compliance.
 * 
 * Algorithm: HMAC-SHA1 (standard), 6 digits, 30-second period
 * Window: ±1 step (allow 90s total tolerance)
 */

import { createHmac, randomBytes } from 'crypto';

/**
 * Base32 alphabet per RFC 4648 (without padding)
 * Used for encoding the secret for QR codes
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decodes a Base32 string (RFC 4648) to Uint8Array
 * Handles padding (=) and case insensitivity
 */
export function base32Decode(input: string): Uint8Array {
  // Remove padding and whitespace, convert to uppercase
  const clean = input.replace(/=+/g, '').replace(/\s/g, '').toUpperCase();
  
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid Base32 character: ${char}`);
    }
    
    value = (value << 5) | index;
    bits += 5;
    
    if (bits >= 8) {
      bits -= 8;
      output.push((value >> bits) & 0xff);
    }
  }
  
  return new Uint8Array(output);
}

/**
 * Encodes a Uint8Array to Base32 string (RFC 4648) without padding
 */
export function base32Encode(data: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(value >> bits) & 0x1f];
    }
  }
  
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  
  return output;
}

/**
 * Generates a cryptographically secure random secret for TOTP
 * @param bytes - Number of bytes (default 20 = 160 bits, RFC 6238 recommends >= 128 bits)
 * @returns Base32 encoded secret string
 */
export function generateSecret(bytes: number = 20): string {
  const secret = randomBytes(bytes);
  return base32Encode(secret);
}

/**
 * Computes HMAC-SHA1 of the counter value using the secret key
 * @param secret - Base32 encoded secret key
 * @param counter - 8-byte big-endian counter value
 * @returns 20-byte HMAC-SHA1 digest
 */
function hmacSha1(secret: string, counter: Uint8Array): Uint8Array {
  const key = base32Decode(secret);
  const hmac = createHmac('sha1', key);
  hmac.update(counter);
  return new Uint8Array(hmac.digest());
}

/**
 * Dynamic Truncation per RFC 4226 Section 5.3
 * Extracts a 4-byte integer from the HMAC result
 * @param hmacResult - 20-byte HMAC-SHA1 digest
 * @returns 31-bit integer (signed integer with MSB masked)
 */
function dynamicTruncation(hmacResult: Uint8Array): number {
  // Offset is the low 4 bits of the last byte
  const offset = hmacResult[hmacResult.length - 1] & 0x0f;
  
  // Extract 4 bytes starting at offset (big-endian)
  const code =
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff);
  
  return code;
}

/**
 * Generates a TOTP code for the given secret and time step
 * @param secret - Base32 encoded secret
 * @param timeStep - Time step counter (typically Math.floor(Date.now() / 1000 / period))
 * @param digits - Number of digits (default 6)
 * @returns TOTP code as zero-padded string
 */
export function generateTOTP(
  secret: string,
  timeStep: number,
  digits: number = 6
): string {
  // Convert timeStep to 8-byte big-endian buffer
  const counter = new Uint8Array(8);
  let step = timeStep;
  for (let i = 7; i >= 0; i--) {
    counter[i] = step & 0xff;
    step = step >> 8;
  }
  
  const hmacResult = hmacSha1(secret, counter);
  const truncated = dynamicTruncation(hmacResult);
  
  // Modulo 10^digits
  const mod = 10 ** digits;
  const code = truncated % mod;
  
  // Zero-pad to required digits
  return code.toString().padStart(digits, '0');
}

/**
 * Verifies a TOTP code with window tolerance
 * @param secret - Base32 encoded secret
 * @param code - TOTP code to verify (6 digits)
 * @param window - Number of time steps to check before/after current (default 1 = ±30s)
 * @param period - Time period in seconds (default 30)
 * @returns Object with verified boolean and the time step delta used (0 = current, -1 = previous, 1 = next)
 */
export function verifyTOTP(
  secret: string,
  code: string,
  window: number = 1,
  period: number = 30
): { verified: boolean; delta: number } {
  const currentStep = Math.floor(Date.now() / 1000 / period);
  
  // Check current step and ±window steps
  for (let delta = -window; delta <= window; delta++) {
    const step = currentStep + delta;
    const expectedCode = generateTOTP(secret, step);
    
    // Constant-time comparison to prevent timing attacks
    if (timingSafeEqual(code, expectedCode)) {
      return { verified: true, delta };
    }
  }
  
  return { verified: false, delta: 0 };
}

/**
 * Constant-time string comparison to prevent timing attacks
 * @param a - First string
 * @param b - Second string
 * @returns true if strings are equal
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still compare all characters to avoid early return timing leak
    let result = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const charA = i < a.length ? a.charCodeAt(i) : 0;
      const charB = i < b.length ? b.charCodeAt(i) : 0;
      result |= charA ^ charB;
    }
    return result === 0;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Generates an otpauth:// URL for QR code enrollment
 * @param secret - Base32 encoded secret
 * @param accountName - User's email or identifier
 * @param issuer - Service name (default 'Omyxia')
 * @returns otpauth URL string
 */
export function generateOtpAuthUrl(
  secret: string,
  accountName: string,
  issuer: string = 'Omyxia'
): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedAccount = encodeURIComponent(accountName);
  const encodedSecret = secret;
  
  return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${encodedSecret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Parses an otpauth:// URL and extracts the secret
 * @param url - otpauth URL
 * @returns Object with secret, issuer, accountName, or throws on invalid format
 */
export function parseOtpAuthUrl(url: string): { secret: string; issuer: string; accountName: string } {
  try {
    const parsed = new URL(url);
    
    if (parsed.protocol !== 'otpauth:') {
      throw new Error('Invalid protocol');
    }
    
    if (parsed.hostname !== 'totp') {
      throw new Error('Only TOTP is supported');
    }
    
    const secret = parsed.searchParams.get('secret');
    if (!secret) {
      throw new Error('Missing secret parameter');
    }
    
    const issuer = parsed.searchParams.get('issuer') || '';
    const accountName = parsed.pathname.slice(1); // Remove leading '/'
    
    return { secret, issuer, accountName };
  } catch (error) {
    throw new Error(`Invalid otpauth URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Default TOTP configuration constants
 */
export const TOTP_CONFIG = {
  ALGORITHM: 'SHA1' as const,
  DIGITS: 6,
  PERIOD: 30,
  WINDOW: 1, // ±1 step = 90 seconds total tolerance
  SECRET_BYTES: 20, // 160 bits
} as const;