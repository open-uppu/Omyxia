import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import {
  RequiresService,
  REQUIRES_SERVICE_METADATA_KEY,
  type RequiresServiceMetadata,
} from './requires-service.decorator';

@RequiresService('erp')
class SampleErpController {
  @RequiresService('erp', { soft: true })
  getJournals() {}
}

describe('RequiresService decorator', () => {
  const reflector = new Reflector();

  it('sets metadata on controller class', () => {
    const meta = reflector.get<RequiresServiceMetadata>(
      REQUIRES_SERVICE_METADATA_KEY,
      SampleErpController,
    );
    expect(meta).toEqual({
      serviceId: 'erp',
      options: undefined,
    });
  });

  it('sets metadata on method handler with options', () => {
    const meta = reflector.get<RequiresServiceMetadata>(
      REQUIRES_SERVICE_METADATA_KEY,
      SampleErpController.prototype.getJournals,
    );
    expect(meta).toEqual({
      serviceId: 'erp',
      options: { soft: true },
    });
  });
});
