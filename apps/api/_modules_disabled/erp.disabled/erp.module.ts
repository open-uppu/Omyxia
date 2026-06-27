import { Module } from '@nestjs/common';
import { ChartOfAccountsController } from './chart-of-accounts.controller';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';
import { ArController } from './ar.controller';
import { ArService } from './ar.service';
import { ApController } from './ap.controller';
import { ApService } from './ap.service';
import { TaxController } from './tax.controller';
import { TaxService } from './tax.service';
import { FiscalPeriodController } from './fiscal-period.controller';
import { FiscalPeriodService } from './fiscal-period.service';

@Module({
  controllers: [
    ChartOfAccountsController,
    JournalController,
    ArController,
    ApController,
    TaxController,
    FiscalPeriodController,
  ],
  providers: [
    ChartOfAccountsService,
    JournalService,
    ArService,
    ApService,
    TaxService,
    FiscalPeriodService,
  ],
  exports: [
    ChartOfAccountsService,
    JournalService,
    ArService,
    ApService,
    TaxService,
    FiscalPeriodService,
  ],
})
export class ErpModule {}