import { Module } from '@nestjs/common';
import { SlotLedgerService } from './slot-ledger.service';

@Module({
  providers: [SlotLedgerService],
  exports: [SlotLedgerService],
})
export class SchedulingModule {}
