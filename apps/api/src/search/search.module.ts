import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { PrismaModule } from '../common/prisma/prisma.module';
import { TenantContextModule } from '../common/tenant-context/tenant-context.module';

@Module({
  imports: [PrismaModule, TenantContextModule],
  providers: [SearchService],
  controllers: [SearchController],
  exports: [SearchService],
})
export class SearchModule {}