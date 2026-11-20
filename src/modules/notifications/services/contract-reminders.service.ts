import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { todayInVietnam } from '../../../core/business/business-helpers';

@Injectable()
export class ContractRemindersService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger(ContractRemindersService.name);
  constructor(private readonly prisma: PrismaService) {}
  onApplicationBootstrap() {
    if (process.env.CONTRACT_REMINDERS_ENABLED !== 'true') return;
    // Kiểm tra khi bật server và mỗi giờ; unique index ngăn nhắc trùng khi nhiều server cùng chạy.
    const run = () => {
      void this.runExpiryReminders().catch(() =>
        this.logger.error(
          'Không tạo được nhắc hết hạn; cần kiểm tra kết nối DB.',
        ),
      );
    };
    run();
    this.timer = setInterval(run, 3_600_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async runExpiryReminders() {
    const today = todayInVietnam(),
      deadline = new Date(today.getTime() + 15 * 86_400_000);
    const contracts = await this.prisma.medicalContract.findMany({
      where: {
        contractStatus: 'ACTIVE',
        isDemo: false,
        endDate: { gt: today, lte: deadline },
      },
      select: {
        id: true,
        endDate: true,
        familyUnit: { select: { representativeUserId: true } },
      },
    });
    if (!contracts.length) return { created: 0 };
    const result = await this.prisma.notification.createMany({
      data: contracts.map((c) => ({
        userId: c.familyUnit.representativeUserId,
        title: 'Hợp đồng sắp hết hạn',
        content: `Hợp đồng hết hạn ngày ${c.endDate.toISOString().slice(0, 10)}. Vui lòng xem phương án gia hạn.`,
        type: 'CONTRACT_EXPIRY_15D',
        referenceId: c.id,
      })),
      skipDuplicates: true,
    });
    return { created: result.count };
  }
}
