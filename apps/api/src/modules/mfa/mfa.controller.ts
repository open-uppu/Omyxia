/**
 * MFA Controller - REST endpoints for MFA management
 * Endpoints:
 * - POST /mfa/enroll - Generate secret + QR code + recovery codes
 * - POST /mfa/verify - Verify TOTP or recovery code
 * - POST /mfa/disable - Disable MFA (requires password)
 * - GET /mfa/status - Get MFA status
 * - POST /mfa/regenerate-recovery - Regenerate recovery codes
 */

import { Controller, Post, Get, Body, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MfaService, MfaEnrollmentResult, MfaVerificationResult, MfaStatus } from './mfa.service';

@Controller('mfa')
export class MfaController {
  constructor(private readonly mfaService: MfaService) {}

  /**
   * Enroll in MFA - generates secret, QR code URL, and recovery codes
   * Returns plain recovery codes ONLY ONCE - user must save them
   */
  @Post('enroll')
  async enroll(@Req() req: any): Promise<MfaEnrollmentResult> {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('Unauthenticated');
    }
    return this.mfaService.enroll(userId);
  }

  /**
   * Verify TOTP code or recovery code
   * Rate limited: 5 attempts per minute per user
   */
  @Post('verify')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 requests per 60 seconds
  @HttpCode(HttpStatus.OK)
  async verify(@Req() req: any, @Body() body: { code: string }): Promise<MfaVerificationResult> {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('Unauthenticated');
    }
    if (!body?.code) {
      throw new Error('Code is required');
    }
    return this.mfaService.verify(userId, body.code);
  }

  /**
   * Disable MFA - requires current password for confirmation
   */
  @Post('disable')
  @HttpCode(HttpStatus.OK)
  async disable(@Req() req: any, @Body() body: { password: string }): Promise<{ success: boolean }> {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('Unauthenticated');
    }
    if (!body?.password) {
      throw new Error('Password is required');
    }
    await this.mfaService.disable(userId, body.password);
    return { success: true };
  }

  /**
   * Get MFA status
   */
  @Get('status')
  async getStatus(@Req() req: any): Promise<MfaStatus> {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('Unauthenticated');
    }
    return this.mfaService.getStatus(userId);
  }

  /**
   * Regenerate recovery codes - requires valid TOTP or recovery code for verification
   */
  @Post('regenerate-recovery')
  @HttpCode(HttpStatus.OK)
  async regenerateRecoveryCodes(
    @Req() req: any,
    @Body() body: { verificationCode: string }
  ): Promise<{ recoveryCodes: string[] }> {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('Unauthenticated');
    }
    if (!body?.verificationCode) {
      throw new Error('Verification code is required');
    }
    const recoveryCodes = await this.mfaService.regenerateRecoveryCodes(userId, body.verificationCode);
    return { recoveryCodes };
  }
}

function throwUnauthenticated(): never {
  throw new Error('Unauthenticated');
}