/**
 * MFA Controller - REST endpoints for MFA management
 *
 * Endpoints:
 *  - POST /mfa/enroll           — generate secret + QR + recovery codes
 *  - POST /mfa/verify           — verify TOTP or recovery code (rate-limited)
 *  - POST /mfa/disable          — disable MFA (requires password re-auth)
 *  - GET  /mfa/status           — get MFA status
 *  - POST /mfa/regenerate-recovery — regenerate recovery codes (requires verify)
 */

import { Controller, Post, Get, Body, Req, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { MfaService, MfaEnrollmentResult, MfaVerificationResult, MfaStatus } from './mfa.service';
import { MfaRateLimitGuard } from './mfa-rate-limit.guard';

@Controller('mfa')
@UseGuards(MfaRateLimitGuard)
export class MfaController {
  constructor(private readonly mfaService: MfaService) {}

  /**
   * Enroll in MFA - generates secret, QR code URL, and recovery codes.
   * Returns plain recovery codes ONLY ONCE - user must save them.
   *
   * Idempotency: enrolling when MFA is already active throws 409 Conflict.
   */
  @Post('enroll')
  async enroll(@Req() req: any): Promise<MfaEnrollmentResult> {
    const userId = req.user?.sub;
    if (!userId) throw new Error('Unauthenticated');
    return this.mfaService.enroll(userId);
  }

  /**
   * Verify TOTP code or recovery code. Rate-limited to 5 attempts per 60s per
   * user (see MfaRateLimitGuard). TOTP replay protection is enforced in the
   * service: a code consumed within the current 30s window cannot be reused.
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(@Req() req: any, @Body() body: { code: string }): Promise<MfaVerificationResult> {
    const userId = req.user?.sub;
    if (!userId) throw new Error('Unauthenticated');
    if (!body?.code) throw new Error('Code is required');
    return this.mfaService.verify(userId, body.code);
  }

  /**
   * Disable MFA - requires current password for confirmation (re-auth).
   */
  @Post('disable')
  @HttpCode(HttpStatus.OK)
  async disable(@Req() req: any, @Body() body: { password: string }): Promise<{ success: boolean }> {
    const userId = req.user?.sub;
    if (!userId) throw new Error('Unauthenticated');
    if (!body?.password) throw new Error('Password is required');
    await this.mfaService.disable(userId, body.password);
    return { success: true };
  }

  /**
   * Get MFA status.
   */
  @Get('status')
  async getStatus(@Req() req: any): Promise<MfaStatus> {
    const userId = req.user?.sub;
    if (!userId) throw new Error('Unauthenticated');
    return this.mfaService.getStatus(userId);
  }

  /**
   * Regenerate recovery codes - requires a valid TOTP or recovery code first.
   */
  @Post('regenerate-recovery')
  @HttpCode(HttpStatus.OK)
  async regenerateRecoveryCodes(
    @Req() req: any,
    @Body() body: { verificationCode: string },
  ): Promise<{ recoveryCodes: string[] }> {
    const userId = req.user?.sub;
    if (!userId) throw new Error('Unauthenticated');
    if (!body?.verificationCode) throw new Error('Verification code is required');
    const recoveryCodes = await this.mfaService.regenerateRecoveryCodes(userId, body.verificationCode);
    return { recoveryCodes };
  }
}