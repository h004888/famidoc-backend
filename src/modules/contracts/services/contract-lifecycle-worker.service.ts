import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  notifyContractParties,
  todayInVietnam,
} from '../../../core/business/business-helpers';
import { AutoScheduleFirstVisitService } from '../../encounters/services/impl/auto-schedule-first-visit.service';

@Injectable()
export class ContractLifecycleWorkerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger(ContractLifecycleWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly autoScheduleFirstVisit?: AutoScheduleFirstVisitService,
  ) {}

  onApplicationBootstrap() {
    if (
      process.env.NODE_ENV === 'test' ||
      process.env.CONTRACT_LIFECYCLE_WORKER_ENABLED === 'false'
    ) {
      return;
    }
    const run = () => {
      void this.runDailyLifecycleTransitions().catch((err) =>
        this.logger.error(
          `Chuyển trạng thái hợp đồng hằng ngày thất bại: ${(err as Error)?.message ?? err}`,
        ),
      );
    };
    run();
    this.timer = setInterval(run, 15 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runDailyLifecycleTransitions(
    now = new Date(),
  ): Promise<{ activatedRenewals: number; expiredContracts: number }> {
    const today = todayInVietnam(now);
    let activatedRenewals = 0;
    let expiredContracts = 0;

    // Bước A: Kích hoạt các kỳ gia hạn PENDING_ACTIVATION đã tới startDate (R2).
    const pendingActivations = await this.prisma.medicalContract.findMany({
      where: {
        contractStatus: 'PENDING_ACTIVATION',
        startDate: { lte: today },
      },
      select: {
        id: true,
        upgradedFromId: true,
        doctorId: true,
        startDate: true,
        endDate: true,
        familyUnit: { select: { representativeUserId: true } },
        facility: { select: { userId: true } },
        doctor: { select: { userId: true } },
      },
      take: 100,
    });

    for (const renewal of pendingActivations) {
      await this.prisma.$transaction(async (tx) => {
        if (renewal.upgradedFromId) {
          const source = await tx.medicalContract.findUnique({
            where: { id: renewal.upgradedFromId },
            select: { id: true, contractStatus: true, doctorId: true },
          });
          if (source && source.contractStatus === 'ACTIVE') {
            await tx.medicalContract.update({
              where: { id: source.id },
              data: { contractStatus: 'EXPIRED' },
            });
            await tx.encounter?.updateMany?.({
              where: {
                contractId: source.id,
                scheduledDate: { gte: today },
                encounterStatus: { in: ['REQUESTED', 'CONFIRMED'] },
              },
              data: {
                encounterStatus: 'CANCELLED',
                cancelReason: 'Hợp đồng kỳ cũ đã hết hạn và chuyển sang kỳ gia hạn mới',
              },
            });
          }
        }

        await tx.medicalContract.update({
          where: { id: renewal.id },
          data: { contractStatus: 'ACTIVE' },
        });

        if (renewal.doctorId) {
          await tx.$queryRaw`SELECT id FROM doctors WHERE id = ${renewal.doctorId}::uuid FOR UPDATE`;
          const count = await tx.medicalContract.count({
            where: { doctorId: renewal.doctorId, contractStatus: 'ACTIVE' },
          });
          await tx.doctor.update({
            where: { id: renewal.doctorId },
            data: { activePanelCount: count },
          });
        }

        await this.autoScheduleFirstVisit?.scheduleOnContractActivated(
          tx,
          renewal.id,
        );

        await notifyContractParties(
          tx,
          {
            id: renewal.id,
            familyId: '',
            familyUnit: renewal.familyUnit,
            facility: renewal.facility,
            doctor: renewal.doctor,
          },
          'Hợp đồng gia hạn đã có hiệu lực',
          `Hợp đồng gia hạn đã chính thức có hiệu lực từ ngày ${renewal.startDate.toISOString().slice(0, 10)} đến ${renewal.endDate.toISOString().slice(0, 10)}.`,
          'CONTRACT_RENEWED',
        );
      });
      activatedRenewals += 1;
    }

    // Bước B: Chuyển hợp đồng ACTIVE có endDate < today sang EXPIRED (R2: giữ nguyên nếu endDate === today).
    const expiredActive = await this.prisma.medicalContract.findMany({
      where: {
        contractStatus: 'ACTIVE',
        endDate: { lt: today },
      },
      select: {
        id: true,
        doctorId: true,
        endDate: true,
      },
      take: 100,
    });

    for (const active of expiredActive) {
      await this.prisma.$transaction(async (tx) => {
        await tx.medicalContract.update({
          where: { id: active.id },
          data: { contractStatus: 'EXPIRED' },
        });
        await tx.encounter?.updateMany?.({
          where: {
            contractId: active.id,
            scheduledDate: { gte: today },
            encounterStatus: { in: ['REQUESTED', 'CONFIRMED'] },
          },
          data: {
            encounterStatus: 'CANCELLED',
            cancelReason: 'Hợp đồng đã hết hạn sử dụng',
          },
        });
        if (active.doctorId) {
          await tx.$queryRaw`SELECT id FROM doctors WHERE id = ${active.doctorId}::uuid FOR UPDATE`;
          const count = await tx.medicalContract.count({
            where: { doctorId: active.doctorId, contractStatus: 'ACTIVE' },
          });
          await tx.doctor.update({
            where: { id: active.doctorId },
            data: { activePanelCount: count },
          });
        }
      });
      expiredContracts += 1;
    }

    return { activatedRenewals, expiredContracts };
  }
}
