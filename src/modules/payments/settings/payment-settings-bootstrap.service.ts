import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { PaymentSettingsService } from './payment-settings.service';

@Injectable()
export class PaymentSettingsBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(PaymentSettingsBootstrapService.name);

  constructor(
    private readonly settings: PaymentSettingsService,
    private readonly prisma: PrismaService,
  ) {}
  async onModuleInit() {
    if (
      !['simulation', 'sepay_test', 'live'].includes(
        process.env.PAYMENTS_MODE ?? '',
      )
    )
      return;
    const environment = this.settings.config.getEnvironment();
    if (await this.settings.repository.current(environment)) return;
    const legacy = this.settings.environmentSnapshot(environment);
    await this.settings.assertLegacyMapping(this.prisma, environment, legacy);
    // A fresh installation can be configured through settings; pending legacy invoices require a valid mapping.
    if (legacy) {
      await this.settings.repository.bootstrap(legacy);
    } else {
      this.logger.warn(
        `Skipped automatic payment settings bootstrap for ${environment}: environment snapshot is incomplete (check PAYMENTS_EXPECTED_ACCOUNT, PAYMENTS_EXPECTED_GATEWAY, SEPAY_BANK_ACCOUNT_ID_${environment}, SEPAY_API_TOKEN_${environment}, and webhook credentials).`,
      );
    }
  }
}
