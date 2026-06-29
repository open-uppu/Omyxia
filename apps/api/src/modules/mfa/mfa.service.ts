/**
 * MFA Service - Handles TOTP enrollment, verification, and recovery codes
 * Integrates with Prisma for persistence
 */

import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import {
  generateSecret,
  generateTOTP,
  verifyTOTP,
  generateOtpAuthUrl,
  TOTP_CONFIG,
} from './totp';
import {
  generateRecoveryCodes,
  hashRecoveryCodes,
  verifyAndConsumeRecoveryCode,
  RECOVERY_CONFIG,
} from './recovery';

export interface MfaEnrollmentResult {
  secret: string;
  otpAuthUrl: string;
  recoveryCodes: string[];
}

export interface MfaVerificationResult {
  verified: boolean;
  method: 'totp' | 'recovery';
  recoveryCodesRemaining?: number;
}

export interface MfaStatus {
  enabled: boolean;
  type: 'totp' | 'recovery' | null;
  recoveryCodesRemaining?: number;
}

@Injectable()
export class MfaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Enrolls a user in MFA (TOTP)
   * Generates secret, QR code URL, and recovery codes
   */
  async enroll(userId: string): Promise<MfaEnrollmentResult> {
    // Check if user already has active MFA
    const existingFactor = await this.prisma.mfaFactor.findFirst({
      where: { userId, isActive: true },
    });

    if (existingFactor) {
      throw new ConflictException('MFA is already enabled for this user');
    }

    // Generate TOTP secret
    const secret = generateSecret(TOTP_CONFIG.SECRET_BYTES);

    // Generate recovery codes
    const recoveryCodes = generateRecoveryCodes(RECOVERY_CONFIG.COUNT);
    const hashedRecoveryCodes = await hashRecoveryCodes(recoveryCodes);

    // Get user email for otpauth URL
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const otpAuthUrl = generateOtpAuthUrl(secret, user.email);

    // Store MFA factor with hashed recovery codes
    await this.prisma.mfaFactor.create({
      data: {
        userId,
        type: 'TOTP',
        secret,
        backupCodes: hashedRecoveryCodes,
        isActive: true,
      },
    });

    return {
      secret,
      otpAuthUrl,
      recoveryCodes, // Return plain codes only once during enrollment
    };
  }

  /**
   * Verifies a TOTP code or recovery code
   * Implements replay protection for TOTP (same code can't be used twice in window)
   */
  async verify(userId: string, code: string): Promise<MfaVerificationResult> {
    const factor = await this.prisma.mfaFactor.findFirst({
      where: { userId, isActive: true },
    });

    if (!factor) {
      throw new UnauthorizedException('MFA not enabled for this user');
    }

    // Try TOTP verification first
    if (factor.secret) {
      const totpResult = verifyTOTP(factor.secret, code, TOTP_CONFIG.WINDOW, TOTP_CONFIG.PERIOD);
      
      if (totpResult.verified) {
        // Check replay protection: ensure this code wasn't used in the current window
        const lastUsedAt = factor.lastUsedAt;
        const currentStep = Math.floor(Date.now() / 1000 / TOTP_CONFIG.PERIOD);
        const lastUsedStep = lastUsedAt 
          ? Math.floor(lastUsedAt.getTime() / 1000 / TOTP_CONFIG.PERIOD)
          : null;

        // If last used was in the same or adjacent step (within window), reject replay
        if (lastUsedStep !== null && Math.abs(currentStep - lastUsedStep) <= TOTP_CONFIG.WINDOW) {
          throw new UnauthorizedException('Code already used. Please wait for the next code.');
        }

        // Update lastUsedAt to prevent replay
        await this.prisma.mfaFactor.update({
          where: { id: factor.id },
          data: { lastUsedAt: new Date() },
        });

        return {
          verified: true,
          method: 'totp',
          recoveryCodesRemaining: factor.backupCodes.length,
        };
      }
    }

    // Try recovery code verification
    if (factor.backupCodes.length > 0) {
      const recoveryCodes = [...factor.backupCodes]; // Copy for modification
      const consumed = await verifyAndConsumeRecoveryCode(code, recoveryCodes);
      
      if (consumed) {
        // Update with remaining recovery codes
        await this.prisma.mfaFactor.update({
          where: { id: factor.id },
          data: { 
            backupCodes: recoveryCodes,
            lastUsedAt: new Date(),
          },
        });

        return {
          verified: true,
          method: 'recovery',
          recoveryCodesRemaining: recoveryCodes.length,
        };
      }
    }

    throw new UnauthorizedException('Invalid code');
  }

  /**
   * Disables MFA for a user (requires current password for confirmation)
   */
  async disable(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid password');
    }

    const factor = await this.prisma.mfaFactor.findFirst({
      where: { userId, isActive: true },
    });

    if (!factor) {
      throw new BadRequestException('MFA is not enabled');
    }

    await this.prisma.mfaFactor.update({
      where: { id: factor.id },
      data: { isActive: false },
    });
  }

  /**
   * Gets MFA status for a user
   */
  async getStatus(userId: string): Promise<MfaStatus> {
    const factor = await this.prisma.mfaFactor.findFirst({
      where: { userId, isActive: true },
    });

    if (!factor) {
      return { enabled: false, type: null };
    }

    return {
      enabled: true,
      type: factor.type === 'TOTP' ? 'totp' : 'recovery',
      recoveryCodesRemaining: factor.backupCodes.length,
    };
  }

  /**
   * Regenerates recovery codes (requires valid TOTP or recovery code)
   */
  async regenerateRecoveryCodes(userId: string, verificationCode: string): Promise<string[]> {
    const factor = await this.prisma.mfaFactor.findFirst({
      where: { userId, isActive: true },
    });

    if (!factor) {
      throw new BadRequestException('MFA not enabled');
    }

    // Verify the provided code first
    await this.verify(userId, verificationCode);

    // Generate new recovery codes
    const newRecoveryCodes = generateRecoveryCodes(RECOVERY_CONFIG.COUNT);
    const hashedRecoveryCodes = await hashRecoveryCodes(newRecoveryCodes);

    await this.prisma.mfaFactor.update({
      where: { id: factor.id },
      data: { backupCodes: hashedRecoveryCodes },
    });

    return newRecoveryCodes;
  }
}