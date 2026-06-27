import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return {
      status: 'ok',
      service: 'omyxia-api',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  @Get('ready')
  ready() {
    return {
      status: 'ready',
      service: 'omyxia-api',
      version: '0.1.0',
    };
  }
}