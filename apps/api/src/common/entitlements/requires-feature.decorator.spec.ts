import { describe, expect, it } from 'vitest';
import {
  FEATURE_METADATA_KEY,
  RequiresFeature,
} from './requires-feature.decorator';

describe('@RequiresFeature decorator', () => {
  it('attaches metadata readable via Reflector-style getAllAndOverride', () => {
    // Decorate a stand-in handler.
    class FakeController {
      @RequiresFeature('module.crm')
      listPipelines() {
        return [];
      }
    }

    const handler = FakeController.prototype.listPipelines;
    const meta = Reflect.getMetadata(FEATURE_METADATA_KEY, handler);

    expect(meta).toBeDefined();
    expect(meta.feature).toBe('module.crm');
    expect(meta.options).toEqual({});
  });

  it('captures max + soft options', () => {
    class FakeController {
      @RequiresFeature('limit.maxEmployees', { max: 25, soft: true })
      createEmployee() {
        return {};
      }
    }

    const handler = FakeController.prototype.createEmployee;
    const meta = Reflect.getMetadata(FEATURE_METADATA_KEY, handler);

    expect(meta.feature).toBe('limit.maxEmployees');
    expect(meta.options.max).toBe(25);
    expect(meta.options.soft).toBe(true);
  });

  it('supports class-level decoration', () => {
    @RequiresFeature('module.crm')
    class FakeCtrl {}

    const meta = Reflect.getMetadata(FEATURE_METADATA_KEY, FakeCtrl);
    expect(meta.feature).toBe('module.crm');
  });
});
