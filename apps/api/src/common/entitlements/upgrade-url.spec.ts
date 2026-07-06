import { describe, expect, it } from 'vitest';
import { buildUpgradeUrl } from './upgrade-url';

describe('buildUpgradeUrl', () => {
  it('returns /upgrade path with feature + plan params', () => {
    const url = buildUpgradeUrl({
      feature: 'module.crm',
      currentPlan: 'FREE',
      baseUrl: 'https://admin.omyxia.app',
    });
    expect(url).toContain('/upgrade?');
    expect(url).toContain('feature=module.crm');
    expect(url).toContain('plan=FREE');
    expect(url).toContain('recommendedPlan=PRO');
  });

  it('strips trailing slash from base', () => {
    const url = buildUpgradeUrl({
      feature: 'module.crm',
      currentPlan: 'PRO',
      baseUrl: 'https://admin.omyxia.app///',
    });
    expect(url).toMatch(/^https:\/\/admin\.omyxia\.app\/upgrade\?/);
  });

  it('includes recommendedPlan for known features', () => {
    const url = buildUpgradeUrl({
      feature: 'module.crm',
      currentPlan: 'FREE',
    });
    expect(url).toContain('recommendedPlan=PRO');
  });

  it('omits recommendedPlan when feature has no recommended plan', () => {
    const url = buildUpgradeUrl({
      feature: 'module.crm',
      currentPlan: 'PRO',
    });
    expect(url).toContain('recommendedPlan=PRO'); // crm has PRO
  });

  it('encodes the `from` param using URLSearchParams rules', () => {
    const url = buildUpgradeUrl({
      feature: 'module.crm',
      currentPlan: 'PRO',
      from: '/crm/pipelines',
    });
    expect(url).toContain('from=%2Fcrm%2Fpipelines');
  });

  it('falls back to admin.omyxia.app when no base provided', () => {
    const saved = process.env.APP_URL;
    delete process.env.APP_URL;
    const url = buildUpgradeUrl({ feature: 'module.crm', currentPlan: 'PRO' });
    expect(url.startsWith('https://admin.omyxia.app/upgrade?')).toBe(true);
    if (saved) process.env.APP_URL = saved;
  });
});
