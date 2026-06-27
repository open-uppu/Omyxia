import { Module } from '@nestjs/common';
import { FrmService } from './frm.service';
import { FrmController } from './frm.controller';
import { MasService } from './mas.service';
import { MasController } from './mas.controller';
import { PmsService } from './pms.service';
import { PmsController } from './pms.controller';
import { DmsService } from './dms.service';
import { DmsController } from './dms.controller';
import { WmsService } from './wms.service';
import { WmsController } from './wms.controller';
import { SrmService } from './srm.service';
import { SrmController } from './srm.controller';
import { ItsmService } from './itsm.service';
import { ItsmController } from './itsm.controller';
import { FmsService } from './fms.service';
import { FmsController } from './fms.controller';
import { EndpointSecurityService } from './endpoint-security.service';
import { EndpointSecurityController } from './endpoint-security.controller';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';

@Module({
  controllers: [
    FrmController, MasController, PmsController, DmsController,
    WmsController, SrmController, ItsmController, FmsController,
    EndpointSecurityController, BackupController,
  ],
  providers: [
    FrmService, MasService, PmsService, DmsService,
    WmsService, SrmService, ItsmService, FmsService,
    EndpointSecurityService, BackupService,
  ],
  exports: [
    FrmService, MasService, PmsService, DmsService,
    WmsService, SrmService, ItsmService, FmsService,
    EndpointSecurityService, BackupService,
  ],
})
export class SpecializedModule {}