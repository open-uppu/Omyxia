/**
 * MFA Module - Multi-Factor Authentication feature module
 * Provides TOTP and recovery code functionality with per-user rate limiting.
 */
import { Module } from '@nestjs/common';
import { MfaController } from './mfa.controller';
import { MfaService } from './mfa.service';
import { MfaRateLimitGuard } from './mfa-rate-limit.guard';

@Module({
  controllers: [MfaController],
  providers: [MfaService, MfaRateLimitGuard],
  exports: [MfaService, MfaRateLimitGuard],
})
export class MfaModule {}