import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PaymentsServiceImpl } from '../services/impl/payments.service.impl';
import { CarePackagesServiceImpl } from '../../care-packages/services/impl/care-packages.service.impl';
import { PaymentsConfig } from '../payments.config';
import { PaymentsClock } from '../payments.clock';
import type {
  PaymentsRepository,
  PaymentsSession,
} from '../repositories/interfaces/payments.repository.interface';
import {
  BillingContractStatus,
  PaymentRequestStatus,
  type ActivationRequirements,
  type BillingContract,
} from '../entities/payment.entity';
type CreateBillingContractDto = {
  familyId: string;
  packageId: string;
  memberCount: number;
};
type UpdateActivationRequirementsDto = Partial<ActivationRequirements>;
// Fixture có Map để kiểm thử thuật toán thanh toán; không được đăng ký trong module/API.
export class PaymentTestService extends PaymentsServiceImpl {
  constructor(
    private readonly fixtureRepository: PaymentsRepository,
    private readonly fixturePackages: CarePackagesServiceImpl,
    private readonly fixtureConfig: PaymentsConfig,
    private readonly fixtureClock: PaymentsClock,
  ) {
    super(fixtureRepository, fixtureConfig, fixtureClock);
  }
  // DỮ LIỆU GIẢ: phần này sẽ được thay bằng module hợp đồng đã ký thật của nhóm.
  async createDemoContract(
    dto: CreateBillingContractDto,
  ): Promise<BillingContract> {
    this.fixtureConfig.assertSimulationEnabled();
    // Không nhận snapshot do client tự dựng; lấy phiên bản gói và tính giá ở backend.
    const quote = await this.fixturePackages.quote(dto.packageId, {
      memberCount: dto.memberCount,
    });
    const now = this.fixtureClock.now().toISOString();
    const contract: BillingContract = {
      id: randomUUID(),
      familyId: dto.familyId,
      payerDisplayName: 'Nguyễn Hoài Nam', // Tên mẫu chỉ dùng trong test, production lấy từ User.fullName.
      simulation: true,
      status: BillingContractStatus.PENDING,
      packageSnapshot: {
        package: quote.package,
        members: quote.members,
        pricing: quote.pricing,
        benefits: quote.benefits,
      },
      requirements: {
        familySigned: false,
        adminSigned: false,
        facilitySigned: false,
        doctorSigned: false,
        facilityId: null,
        doctorId: null,
        doctorVerified: false,
        panelCapacityAvailable: false,
      },
      createdAt: now,
      updatedAt: now,
      activeFrom: null,
      activeUntil: null,
    };
    return this.fixtureRepository.transaction(async (session) => {
      await session.saveContract(contract);
      return contract;
    });
  }

  async getContract(id: string): Promise<BillingContract> {
    this.fixtureConfig.assertSimulationEnabled();
    return this.fixtureRepository.transaction((session) =>
      this.requireFixtureContract(session, id),
    );
  }

  async updateDemoRequirements(
    id: string,
    dto: UpdateActivationRequirementsDto,
  ) {
    this.fixtureConfig.assertSimulationEnabled();
    const changes = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(changes).length === 0)
      throw new BadRequestException(
        'Provide at least one activation requirement',
      );
    await this.fixtureRepository.transaction(async (session) => {
      const contract = await this.requireFixtureContract(session, id);
      if (contract.status !== BillingContractStatus.PENDING) {
        throw new ConflictException(
          'Only pending demo contracts can change requirements',
        );
      }
      contract.requirements = { ...contract.requirements, ...changes };
      contract.updatedAt = this.fixtureClock.now().toISOString();
      await session.saveContract(contract);
      // Nếu tiền đã nhận mà trước đó thiếu điều kiện, bổ sung xong sẽ thử kích hoạt lại.
      const activation = {
        contractId: contract.id,
        status: contract.status,
        activated: false,
        blockingReasons: [] as string[],
      };
      return activation;
    });
    const activation = await this.tryActivate(id);
    return { contract: await this.getContract(id), activation };
  }

  async cancelDemoContract(id: string): Promise<BillingContract> {
    this.fixtureConfig.assertSimulationEnabled();
    return this.fixtureRepository.transaction(async (session) => {
      const contract = await this.requireFixtureContract(session, id);
      if (contract.status === BillingContractStatus.CANCELLED) return contract;
      const requests = await session.listRequests(id);
      // Không dùng dữ liệu giả để thanh lý hợp đồng đã trả tiền hoặc đang phục vụ.
      if (
        contract.status === BillingContractStatus.ACTIVE ||
        requests.some((item) => item.status === PaymentRequestStatus.PAID)
      ) {
        throw new ConflictException(
          'Paid or active contracts require the real contract lifecycle workflow',
        );
      }
      contract.status = BillingContractStatus.CANCELLED;
      contract.updatedAt = this.fixtureClock.now().toISOString();
      for (const item of requests) {
        if (item.status === PaymentRequestStatus.PENDING) {
          item.status = PaymentRequestStatus.CANCELLED;
          await session.saveRequest(item);
        }
      }
      await session.saveContract(contract);
      return contract;
    });
  }

  private async requireFixtureContract(session: PaymentsSession, id: string) {
    const item = await session.findContract(id);
    if (!item) throw new NotFoundException('Contract not found');
    return item;
  }
}
