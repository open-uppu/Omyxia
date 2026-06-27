import { Controller, Post, Body, Get } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  async signup(@Body() body: { email: string; password: string; name: string; tenantName: string }) {
    return this.authService.signup(body.email, body.password, body.name, body.tenantName);
  }

  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
  }

  @Post('switch-tenant')
  async switchTenant(@Body() body: { userId: string; tenantId: string }) {
    return this.authService.switchTenant(body.userId, body.tenantId);
  }
}