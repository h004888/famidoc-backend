import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { SePayReconciliationConfig } from '../../payments/sepay/sepay-reconciliation.config';
import { SePayReconciliationService } from './sepay-reconciliation.service';

@Injectable()
export class SePayReconciliationScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger(SePayReconciliationScheduler.name);

  constructor(
    private readonly reconciliation: SePayReconciliationService,
    private readonly config: SePayReconciliationConfig,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.isEnabled()) return;
    const run = () => {
      void this.reconciliation
        .runScheduled()
        .catch((error: unknown) =>
          this.logger.error(
            error instanceof Error
              ? `SePay reconciliation failed: ${error.message}`
              : 'SePay reconciliation failed',
          ),
        );
    };
    run();
    this.timer = setInterval(run, this.config.getIntervalMilliseconds());
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
