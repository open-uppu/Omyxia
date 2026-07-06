/**
 * Public re-exports for the entitlements module.
 *
 * Most consumers only need the decorator + types:
 *
 *   import { RequiresFeature } from '../../common/entitlements';
 *
 * Tests pull in fixtures from `__fixtures__/`.
 */
export * from './requires-feature.decorator';
export * from './feature-gate.guard';
export * from './entitlements.service';
export * from './entitlements.module';
export * from './feature-catalog';
export * from './entitlement.types';
export * from './feature-forbidden.exception';
export * from './upgrade-url';
export * from './usage-lookup.service';
