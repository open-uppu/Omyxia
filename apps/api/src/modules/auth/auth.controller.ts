import { BadRequestException, Body, Controller, ForbiddenException, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  async signup(
    @Body() body: { email: string; password: string; name: string; tenantName: string; locale?: string },
  ) {
    return this.authService.signup(body);
  }

  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
  }

  /**
   * Complete onboarding: rename tenant, set locale, set fiscal year start.
   * Marks tenant.settings.onboardingComplete = true.
   */
  @Post('onboarding/complete')
  async completeOnboarding(
    @Req() req: any,
    @Body() body: { tenantName?: string; locale?: string; fiscalYearStart?: string },
  ) {
    if (!req.user?.sub) throw new ForbiddenException('Unauthenticated');
    return this.authService.completeOnboarding(body);
  }
}