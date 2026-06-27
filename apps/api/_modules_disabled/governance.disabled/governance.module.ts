import { Module } from '@nestjs/common';
import { CmpService } from './cmp.service';
import { CmpController } from './cmp.controller';
import { BiService } from './bi.service';
import { BiController } from './bi.controller';

@Module({
  controllers: [CmpController, BiController],
  providers: [CmpService, BiService],
  exports: [CmpService, BiService],
})
export class GovernanceModule {}