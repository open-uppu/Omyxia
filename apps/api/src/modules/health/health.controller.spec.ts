import { describe, it, expect } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controller = new HealthController();

  it('should return ok status', () => {
    const result = controller.health();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('omyxia-api');
    expect(typeof result.timestamp).toBe('string');
    expect(typeof result.uptime).toBe('number');
  });

  it('should return ready status', () => {
    const result = controller.ready();
    expect(result.status).toBe('ready');
    expect(result.service).toBe('omyxia-api');
    expect(result.version).toBe('0.1.0');
  });
});
