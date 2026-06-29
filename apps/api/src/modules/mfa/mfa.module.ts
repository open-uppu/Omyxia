/**
 * MFA Module - Multi-Factor Authentication feature module
 * Provides TOTP and recovery code functionality
 */

import { Module } from '@nestjs/common';
import { MfaController } from './mfa.controller';
import { MfaService } from './mfa.service';

@Module({
  controllers: [MfaController],
  providers: [MfaService],
  exports: [MfaService],
})
export class MfaModule {}