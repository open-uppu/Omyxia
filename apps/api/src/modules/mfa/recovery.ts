/**
 * Recovery Code Generation and Verification
 * 
 * Generates 10 single-use recovery codes in format XXXXX-XXXXX
 * Codes use alphanumeric characters excluding ambiguous characters (0/O/1/I)
 * Codes are hashed with bcrypt(10) before storage
 * Each code can only be used once
 */

import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';

/**
 * Alphabet for recovery codes - alphanumeric excluding ambiguous characters
 * Excludes: 0, O, 1, I (and lowercase equivalents)
 */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_SEGMENT_LENGTH = 5;
const CODE_SEGMENTS = 2;
const RECOVERY_CODE_COUNT = 10;
const BCRYPT_ROUNDS = 10;
const CODE_FORMAT = `${'X'.repeat(CODE_SEGMENT_LENGTH)}-${'X'.repeat(CODE_SEGMENT_LENGTH)}`;

/**
 * Generates a single recovery code in format XXXXX-XXXXX
 */
function generateSingleCode(): string {
  const bytes = randomBytes(CODE_SEGMENT_LENGTH * CODE_SEGMENTS);
  let code = '';
  
  for (let i = 0; i < CODE_SEGMENT_LENGTH * CODE_SEGMENTS; i++) {
    if (i === CODE_SEGMENT_LENGTH) {
      code += '-';
    }
    code += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  }
  
  return code;
}

/**
 * Generates an array of unique recovery codes
 * @param count - Number of codes to generate (default 10)
 * @returns Array of unique recovery codes
 */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  
  while (codes.size < count) {
    codes.add(generateSingleCode());
  }
  
  return Array.from(codes);
}

/**
 * Hashes a recovery code with bcrypt
 * @param code - Plain text recovery code
 * @returns bcrypt hash
 */
export async function hashRecoveryCode(code: string): Promise<string> {
  return bcrypt.hash(code, BCRYPT_ROUNDS);
}

/**
 * Verifies a recovery code against a bcrypt hash
 * @param code - Plain text recovery code to verify
 * @param hash - Stored bcrypt hash
 * @returns true if code matches hash
 */
export async function verifyRecoveryCode(code: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(code, hash);
  } catch {
    return false;
  }
}

/**
 * Hashes an array of recovery codes
 * @param codes - Array of plain text recovery codes
 * @returns Array of bcrypt hashes
 */
export async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map(code => hashRecoveryCode(code)));
}

/**
 * Verifies a recovery code against a list of hashed codes
 * Returns the index of the matched code (for single-use enforcement)
 * @param code - Plain text recovery code to verify
 * @param hashes - Array of stored bcrypt hashes
 * @returns Index of matched code, or -1 if not found
 */
export async function findMatchingRecoveryCode(code: string, hashes: string[]): Promise<number> {
  for (let i = 0; i < hashes.length; i++) {
    if (await verifyRecoveryCode(code, hashes[i])) {
      return i;
    }
  }
  return -1;
}

/**
 * Validates recovery code format (XXXXX-XXXXX)
 * @param code - Code to validate
 * @returns true if format is valid
 */
export function isValidRecoveryCodeFormat(code: string): boolean {
  // Format: XXXXX-XXXXX where X is alphanumeric (no ambiguous chars)
  const pattern = new RegExp(`^[${RECOVERY_ALPHABET}]{${CODE_SEGMENT_LENGTH}}-?[${RECOVERY_ALPHABET}]{${CODE_SEGMENT_LENGTH}}$`, 'i');
  return pattern.test(code);
}

/**
 * Normalizes a recovery code (uppercase, ensures dash format)
 * @param code - Raw input code
 * @returns Normalized code in XXXXX-XXXXX format
 */
export function normalizeRecoveryCode(code: string): string {
  const clean = code.toUpperCase().replace(/-/g, '');
  if (clean.length !== CODE_SEGMENT_LENGTH * CODE_SEGMENTS) {
    return code.toUpperCase();
  }
  return `${clean.slice(0, CODE_SEGMENT_LENGTH)}-${clean.slice(CODE_SEGMENT_LENGTH)}`;
}

/**
 * Recovery code configuration constants
 */
export const RECOVERY_CONFIG = {
  COUNT: RECOVERY_CODE_COUNT,
  SEGMENT_LENGTH: CODE_SEGMENT_LENGTH,
  SEGMENTS: CODE_SEGMENTS,
  FORMAT: CODE_FORMAT,
  ALPHABET: RECOVERY_ALPHABET,
  BCRYPT_ROUNDS,
} as const;

/**
 * Verifies a recovery code and marks it as used (removes from array)
 * @param code - Plain text recovery code to verify
 * @param hashes - Array of stored bcrypt hashes (modified in place)
 * @returns true if code was valid and removed, false otherwise
 */
export async function verifyAndConsumeRecoveryCode(
  code: string,
  hashes: string[]
): Promise<boolean> {
  const normalizedCode = normalizeRecoveryCode(code);
  const index = await findMatchingRecoveryCode(normalizedCode, hashes);
  
  if (index === -1) {
    return false;
  }
  
  // Remove the used code (single-use enforcement)
  hashes.splice(index, 1);
  return true;
}