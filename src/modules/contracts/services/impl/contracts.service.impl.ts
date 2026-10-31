import type { ContractSummary } from '../../entities/contract-change.entity';
import { calculateContractTermsHash } from '../../pricing/contract-terms-hash';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type SignerRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import {
  createTermsHash,
  getContractSignerRole,
  todayInVietnam,
} from '../../../../core/business/business-helpers';
import { moneyToNumber } from '../../../../core/database/prisma-transaction';
import { calculateCarePackageQuote } from '../../../care-packages/pricing/calculate-care-package-quote';
import {
  CarePackageStatus,
  QuotaPeriod,
} from '../../../care-packages/entities/care-package.entity';
import { addContractMonths } from '../../../payments/activation/contract-activation';
import {
  CONTRACTS_REPOSITORY_TOKEN,
  type IContractsRepository,
  type ChangeContract,
  type ContractsSession,
} from '../../repositories/interfaces/contracts.repository.interface';
import type { IContractsService } from '../interfaces/contracts.service.interface';
import type {
  CreateContractAddendumDto,
  CreatePackageUpgradeDto,
  SignContractChangeDto,
  TerminateContractDto,
} from '../../dtos/contract-change.dto';
import {
  calculateHomeVisitAddendum,
  calculateMemberAddendum,
  readFrozenContractTerms,
} from '../../pricing/contract-change-pricing';
interface TerminationConsent {
  role: SignerRole;
  userId: string;
  acceptedAt: string;
  termsHash: string;
}
const signingOrder: SignerRole[] = [
  'FAMILY_REP',
  'ADMIN',
  'HEALTHCARE_FACILITY',
  'ASSIGNED_DOCTOR',
];
@Injectable()
export class ContractsServiceImpl implements IContractsService {
  constructor(
    @Inject(CONTRACTS_REPOSITORY_TOKEN)
    private readonly repository: IContractsRepository,
  ) {}
  // Lập điều khoản và tính phí trước; ở bước này chưa cộng người hoặc lượt khám.
  createContractAddendum(
    actor: AuthenticatedUser,
    id: string,
    dto: CreateContractAddendumDto,
  ) {
    return this.repository.transaction(async (session) => {
      const contract = await this.requirePartyContract(session, id, actor);
      if (!['FAMILY_REP', 'ADMIN'].includes(actor.role))
        throw new ForbiddenException(
          'Only the family or Admin can draft an addendum',
        );
      this.assertContractServing(contract);
      const requestKey = `${actor.id}:${dto.requestKey}`;
      const previous = await session.findAddendumByKey(requestKey);
      if (previous) {
        if (previous.contractId !== id || previous.addendumType !== dto.type)
          throw new ConflictException(
            'Request key belongs to a different change',
          );
        const old = previous.termsSnapshot as Record<string, unknown>;
        if (
          (old.additionalMembers ?? 0) !== (dto.additionalMembers ?? 0) ||
          old.extraHomeVisits !== (dto.extraHomeVisits ?? 0)
        )
          throw new ConflictException(
            'Request key was reused with different terms',
          );
        return previous;
      }
      const terms = readFrozenContractTerms(contract.billingSnapshot);
      let amount: number;
      if (dto.type === 'QUOTA_EXPANSION') {
        if (dto.additionalMembers)
          throw new BadRequestException('Quota expansion cannot add members');
        amount = calculateHomeVisitAddendum(terms, dto.extraHomeVisits!);
      } else {
        if (dto.extraHomeVisits)
          throw new BadRequestException('Adding members does not add visits');
        if (await session.hasPendingMemberAddendum(id))
          throw new ConflictException(
            'Finish or cancel the pending member addendum first',
          );
        const added = dto.additionalMembers!;
        const newCount = contract.memberCount + added;
        if (newCount > Math.min(6, terms.members.maxCount))
          throw new BadRequestException(
            'The package supports at most six family members',
          );
        const familyCount = await session.countFamilyMembers(contract.familyId);
        if (newCount < familyCount)
          throw new BadRequestException(
            'Buy enough additional places for the whole family',
          );
        // Chỉ tính phí phần vượt số người đã nằm trong giá gói. Không tính lại tiền người cũ.
        const billableCount =
          Math.max(0, newCount - terms.members.includedCount) -
          Math.max(0, contract.memberCount - terms.members.includedCount);
        amount = calculateMemberAddendum(
          terms,
          billableCount,
          contract.startDate,
          contract.endDate,
          todayInVietnam(),
        );
      }
      const snapshot = {
        familyId: contract.familyId,
        facilityId: contract.facilityId,
        doctorId: contract.doctorId,
        type: dto.type,
        additionalMembers: dto.additionalMembers ?? 0,
        previousMemberCount: contract.memberCount,
        newMemberCount: contract.memberCount + (dto.additionalMembers ?? 0),
        extraHomeVisits: dto.extraHomeVisits ?? 0,
        extraTelehealth: 0,
        additionalAmountVnd: amount,
        calculatedOn: todayInVietnam().toISOString(),
        contractEnd: contract.endDate.toISOString(),
      };
      const addendum = await session.createAddendum({
        contractId: id,
        addendumNumber: 'AD' + randomUUID().replaceAll('-', '').toUpperCase(),
        addendumType: dto.type,
        additionalAmount: amount,
        extraHomeVisits: dto.extraHomeVisits ?? 0,
        extraTelehealth: 0,
        termsSnapshot: snapshot,
        termsHash: createTermsHash({ contractId: id, ...snapshot }),
        requestKey,
      });
      await session.recordChange(
        actor.id,
        contract,
        'CREATE_CONTRACT_ADDENDUM',
        addendum.id,
      );
      return addendum;
    });
  }
  // Chỉ mở kỳ mới khi hợp đồng cũ đã hết hạn hoặc được duyệt chấm dứt.
  createPackageUpgradeContract(
    actor: AuthenticatedUser,
    id: string,
    dto: CreatePackageUpgradeDto,
  ) {
    return this.repository.transaction(async (session) => {
      const old = await this.requirePartyContract(session, id, actor);
      if (!['FAMILY_REP', 'ADMIN'].includes(actor.role))
        throw new ForbiddenException(
          'Only the family or Admin can request a replacement contract',
        );
      const today = todayInVietnam();
      if (
        !['EXPIRED', 'TERMINATED'].includes(old.contractStatus) &&
        old.endDate > today
      )
        throw new ConflictException(
          'The old contract must expire or complete approved early termination first',
        );
      if (!['ACTIVE', 'EXPIRED', 'TERMINATED'].includes(old.contractStatus))
        throw new ConflictException(
          'An unsigned/unpaid contract cannot be used for renewal or upgrade',
        );
      if (old.contractStatus === 'ACTIVE') {
        await session.updateContractStatus(old.id, 'EXPIRED');
        await session.refreshDoctorPanel(old.doctorId);
      }
      const existing = await session.findOpenUpgrade(id);
      if (existing) {
        const familyCount = await session.countFamilyMembers(old.familyId);
        if (
          existing.packageId !== dto.packageId ||
          existing.memberCount !== familyCount
        )
          throw new ConflictException(
            'A different replacement contract is already pending',
          );
        return this.toContractSummary(existing);
      }
      if (await session.hasOtherActiveContract(old.familyId, old.id))
        throw new ConflictException(
          'The family already has another active contract',
        );
      const pkg = await session.findPackage(dto.packageId);
      if (!pkg || pkg.status !== 'ACTIVE' || pkg.deletedAt)
        throw new NotFoundException('Active package not found');
      const oldTerms = readFrozenContractTerms(old.billingSnapshot);
      if (
        dto.kind === 'UPGRADE' &&
        pkg.durationMonths <= oldTerms.package.durationMonths
      )
        throw new BadRequestException(
          'Choose a higher package term, or use RENEWAL for the same term',
        );
      if (dto.kind === 'RENEWAL' && pkg.lineageCode !== oldTerms.package.code)
        throw new BadRequestException('Renewal must use the same package line');
      // Gói áp dụng cho toàn bộ gia đình. Số người lấy từ DB, không lấy danh sách do client chọn.
      const memberCount = await session.countFamilyMembers(old.familyId);
      if (memberCount < 1)
        throw new BadRequestException(
          'The family has no active member profiles',
        );
      const quote = calculateCarePackageQuote(
        {
          id: pkg.id,
          code: pkg.lineageCode,
          version: pkg.version,
          name: pkg.packageName,
          description: pkg.description,
          durationMonths: pkg.durationMonths,
          priceVnd: moneyToNumber(pkg.basePrice),
          includedMembers: pkg.includedMembers,
          maxMembers: pkg.maxMembers,
          additionalMemberMonthlyPriceVnd: moneyToNumber(
            pkg.additionalMemberMonthlyPrice,
          ),
          quotaPeriod: pkg.quotaPeriod as QuotaPeriod,
          quotas: {
            homeVisits: pkg.periodicVisitsQuota,
            videoConsultations: pkg.telehealthQuota,
            facilityVisits: 0,
          },
          currency: 'VND',
          status: CarePackageStatus.ACTIVE,
          createdAt: pkg.createdAt.toISOString(),
          updatedAt: pkg.updatedAt.toISOString(),
          publishedAt: pkg.publishedAt?.toISOString() ?? null,
          retiredAt: null,
        },
        memberCount,
      );
      const snapshot = {
        package: quote.package,
        members: quote.members,
        pricing: quote.pricing,
        benefits: quote.benefits,
      };
      // Hợp đồng mới bắt đầu kỳ mới. Không cộng tiền, ngày hay lượt chưa dùng của hợp đồng cũ.
      const item = await session.createUpgrade({
        contractNumber: 'MC' + randomUUID().replaceAll('-', '').toUpperCase(),
        familyId: old.familyId,
        facilityId: old.facilityId,
        doctorId: old.doctorId,
        packageId: pkg.id,
        totalAmount: quote.pricing.totalPriceVnd,
        remainingHomeVisits: pkg.periodicVisitsQuota,
        remainingTelehealth: pkg.telehealthQuota,
        startDate: today,
        endDate: addContractMonths(today, pkg.durationMonths),
        contractStatus: 'PENDING_APPROVAL',
        billingSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        memberCount,
        isDemo: old.isDemo,
        upgradedFromId: old.id,
      });
      await session.recordChange(
        actor.id,
        item,
        'CREATE_PACKAGE_UPGRADE_CONTRACT',
        item.id,
      );
      return this.toContractSummary(item);
    });
  }
  getContractChangeTerms(
    actor: AuthenticatedUser,
    id: string,
    addendumId?: string,
  ) {
    return this.repository.transaction(async (session) => {
      const contract = await this.requirePartyContract(session, id, actor);
      if (addendumId) {
        const item = await session.findAddendum(addendumId);
        if (!item || item.contractId !== id)
          throw new NotFoundException('Addendum not found');
        return {
          id: item.id,
          termsHash: item.termsHash,
          terms: item.termsSnapshot,
          amountVnd: moneyToNumber(item.additionalAmount),
          status: item.status,
          signedRoles: item.signatures.map((s) => s.signerRole),
        };
      }
      return {
        id: contract.id,
        termsHash: calculateContractTermsHash(contract),
        terms: contract.billingSnapshot,
        memberCount: contract.memberCount,
        startDate: contract.startDate,
        endDate: contract.endDate,
        status: contract.contractStatus,
        signedRoles: (await session.findContractSignatures(id)).map(
          (s) => s.signerRole,
        ),
      };
    });
  }
  // Mỗi bên xác nhận bằng tài khoản của chính mình, theo đúng thứ tự trong hợp đồng.
  signContractAddendum(
    actor: AuthenticatedUser,
    id: string,
    addendumId: string,
    dto: SignContractChangeDto,
    ip: string,
  ) {
    return this.repository.transaction(async (session) => {
      const contract = await this.requirePartyContract(session, id, actor);
      this.assertContractServing(contract);
      const item = await session.findAddendum(addendumId);
      if (!item || item.contractId !== id)
        throw new NotFoundException('Addendum not found');
      if (item.status !== 'PENDING_PAYMENT')
        throw new ConflictException(
          'Addendum is no longer awaiting signatures/payment',
        );
      const role = getContractSignerRole(contract, actor);
      this.validateAcceptance(dto, item.termsHash);
      const old = item.signatures.find((s) => s.signerRole === role);
      if (old) {
        if (old.signerUserId !== actor.id)
          throw new ConflictException('This role has already signed');
        return old;
      }
      this.assertSigningOrder(
        role,
        item.signatures.map((s) => s.signerRole),
      );
      // Lưu việc tài khoản đã xác nhận đúng bản điều khoản. Không giả chữ ký của bên còn lại.
      const signature = await session.saveAddendumSignature({
        contractId: id,
        addendumId,
        signerRole: role,
        signerUserId: actor.id,
        termsHash: item.termsHash,
        signatureHash: createTermsHash({
          termsHash: item.termsHash,
          userId: actor.id,
          at: new Date().toISOString(),
        }),
        ipAddress: ip.slice(0, 45),
      });
      if (
        item.signatures.length === 3 &&
        moneyToNumber(item.additionalAmount) === 0
      )
        await session.activateFreeAddendum(id, item.id);
      await session.recordChange(
        actor.id,
        contract,
        'SIGN_CONTRACT_ADDENDUM',
        item.id,
      );
      return signature;
    });
  }
  signUpgradedContract(
    actor: AuthenticatedUser,
    id: string,
    dto: SignContractChangeDto,
    ip: string,
  ) {
    return this.repository.transaction(async (session) => {
      const contract = await this.requirePartyContract(session, id, actor);
      if (!contract.upgradedFromId)
        throw new ConflictException(
          'Use the core four-party signing flow for an initial contract',
        );
      if (
        !['PENDING_APPROVAL', 'PENDING_PAYMENT'].includes(
          contract.contractStatus,
        )
      )
        throw new ConflictException('Contract is not awaiting signatures');
      const hash = calculateContractTermsHash(contract);
      this.validateAcceptance(dto, hash);
      const role = getContractSignerRole(contract, actor);
      const signatures = await session.findContractSignatures(id);
      const previous = signatures.find((s) => s.signerRole === role);
      if (previous) {
        if (previous.signerUserId !== actor.id)
          throw new ConflictException('This role has already signed');
        return previous;
      }
      this.assertSigningOrder(
        role,
        signatures.map((s) => s.signerRole),
      );
      const item = await session.saveUpgradeSignature({
        contractId: id,
        termsHash: hash,
        signerRole: role,
        signerUserId: actor.id,
        signatureHash: createTermsHash({
          termsHash: hash,
          userId: actor.id,
          at: new Date().toISOString(),
        }),
        ipAddress: ip.slice(0, 45),
      });
      if (signatures.length === 3)
        await session.updateContractStatus(id, 'PENDING_PAYMENT');
      await session.recordChange(
        actor.id,
        contract,
        'SIGN_UPGRADED_CONTRACT',
        id,
      );
      return item;
    });
  }
  // REQUEST chỉ tạo đề nghị. APPROVE của Admin mới thực sự đóng hợp đồng sau khi đủ đồng ý.
  terminateContract(
    actor: AuthenticatedUser,
    id: string,
    dto: TerminateContractDto,
  ) {
    return this.repository.transaction(async (session) => {
      const contract = await this.requirePartyContract(session, id, actor);
      const role = getContractSignerRole(contract, actor);
      if (dto.action === 'REQUEST') {
        if (
          !['FAMILY_REP', 'HEALTHCARE_FACILITY', 'ADMIN'].includes(actor.role)
        )
          throw new ForbiddenException('This actor cannot request termination');
        if (['TERMINATED', 'EXPIRED'].includes(contract.contractStatus))
          throw new ConflictException('The contract has already ended');
        const old = await session.findPendingTermination(id);
        if (old) {
          if (old.reason !== dto.reason)
            throw new ConflictException(
              'A different termination request is pending',
            );
          return old;
        }
        const hash = createTermsHash({
          contractId: id,
          reason: dto.reason,
          amount: contract.totalAmount.toString(),
          endDate: contract.endDate.toISOString(),
        });
        const item = await session.createTermination({
          contractId: id,
          requestedByUserId: actor.id,
          reason: dto.reason!,
          termsHash: hash,
          consents: [
            {
              role,
              userId: actor.id,
              acceptedAt: new Date().toISOString(),
              termsHash: hash,
            },
          ],
        });
        await session.recordChange(
          actor.id,
          contract,
          'REQUEST_CONTRACT_TERMINATION',
          item.id,
        );
        return item;
      }
      const item = await session.findTermination(id, dto.requestId!);
      if (!item || item.contractId !== id)
        throw new NotFoundException('Termination request not found');
      if (item.status !== 'PENDING')
        throw new ConflictException(
          'Termination request has already been decided',
        );
      if (dto.action === 'REJECT') {
        if (actor.role !== 'ADMIN')
          throw new ForbiddenException('Only Admin can reject a request');
        const updated = await session.updateTermination(id, item.id, {
          status: 'REJECTED',
          decisionNotes: dto.reason,
          decidedByUserId: actor.id,
          decidedAt: new Date().toISOString(),
        });
        await session.recordChange(
          actor.id,
          contract,
          'REJECT_CONTRACT_TERMINATION',
          item.id,
        );
        return updated;
      }
      if (dto.termsHash !== item.termsHash)
        throw new ConflictException('Termination terms have changed');
      const consents = item.consents as unknown as TerminationConsent[];
      if (dto.action === 'CONSENT') {
        if (consents.some((c) => c.role === role && c.userId === actor.id))
          return item;
        if (consents.some((c) => c.role === role))
          throw new ConflictException(
            'A different account has already consented for this role',
          );
        const updated = await session.updateTermination(id, item.id, {
          consents: [
            ...consents,
            {
              role,
              userId: actor.id,
              acceptedAt: new Date().toISOString(),
              termsHash: item.termsHash,
            },
          ] as unknown as Prisma.JsonValue,
        });
        await session.recordChange(
          actor.id,
          contract,
          'CONSENT_CONTRACT_TERMINATION',
          item.id,
        );
        return updated;
      }
      if (actor.role !== 'ADMIN')
        throw new ForbiddenException('Only Admin can approve termination');
      const required = [
        ['FAMILY_REP', contract.familyUnit.representativeUserId],
        ['HEALTHCARE_FACILITY', contract.facility.userId],
        ['ASSIGNED_DOCTOR', contract.doctor.userId],
      ];
      if (
        required.some(
          ([r, userId]) =>
            !consents.some(
              (c) =>
                c.role === r &&
                c.userId === userId &&
                c.termsHash === item.termsHash,
            ),
        )
      )
        throw new ConflictException(
          'Family, facility and assigned doctor must agree before Admin approval',
        );
      if (await session.hasEncounterInProgress(id))
        throw new ConflictException(
          'Finish the ongoing encounter before terminating the contract',
        );
      // Chấm dứt quyền dịch vụ, giải phóng panel; giữ nguyên tiền đã nhận và toàn bộ bệnh án.
      await session.updateContractStatus(id, 'TERMINATED', item.reason);
      await session.cancelUnpaidRights(id);
      await session.refreshDoctorPanel(contract.doctorId);
      const updated = await session.updateTermination(id, item.id, {
        status: 'APPROVED',
        decidedByUserId: actor.id,
        decidedAt: new Date().toISOString(),
        consents: [
          ...consents.filter((c) => c.role !== 'ADMIN'),
          {
            role: 'ADMIN',
            userId: actor.id,
            acceptedAt: new Date().toISOString(),
            termsHash: item.termsHash,
          },
        ] as unknown as Prisma.JsonValue,
      });
      await session.recordChange(
        actor.id,
        contract,
        'APPROVE_CONTRACT_TERMINATION',
        item.id,
      );
      return {
        ...updated,
        contractStatus: 'TERMINATED' as const,
        refundProcessed: false as const,
      };
    });
  }
  private toContractSummary(contract: ChangeContract): ContractSummary {
    // Chỉ trả điều khoản hợp đồng. Không trả user/passwordHash hay tài khoản ngân hàng từ include nội bộ.
    return {
      id: contract.id,
      contractNumber: contract.contractNumber,
      familyId: contract.familyId,
      facilityId: contract.facilityId,
      doctorId: contract.doctorId,
      packageId: contract.packageId,
      totalAmount: moneyToNumber(contract.totalAmount),
      remainingHomeVisits: contract.remainingHomeVisits,
      remainingTelehealth: contract.remainingTelehealth,
      startDate: contract.startDate,
      endDate: contract.endDate,
      contractStatus: contract.contractStatus,
      upgradedFromId: contract.upgradedFromId,
      memberCount: contract.memberCount,
      isDemo: contract.isDemo,
    };
  }
  private async requirePartyContract(
    session: ContractsSession,
    id: string,
    actor: AuthenticatedUser,
  ) {
    const contract = await session.findContractForUpdate(id);
    if (!contract) throw new NotFoundException('Contract not found');
    try {
      getContractSignerRole(contract, actor);
    } catch {
      throw new NotFoundException('Contract not found');
    }
    return contract;
  }
  private assertContractServing(contract: ChangeContract) {
    if (
      contract.contractStatus !== 'ACTIVE' ||
      contract.endDate <= todayInVietnam() ||
      contract.startDate > todayInVietnam()
    )
      throw new ConflictException('The contract is not currently serving');
  }
  private validateAcceptance(dto: SignContractChangeDto, hash: string) {
    if (!dto.acceptedTerms)
      throw new BadRequestException('Explicit acceptance is required');
    if (dto.termsHash !== hash)
      throw new ConflictException('Read and accept the current terms');
  }
  private assertSigningOrder(role: SignerRole, signed: SignerRole[]) {
    if (
      signingOrder
        .slice(0, signingOrder.indexOf(role))
        .some((r) => !signed.includes(r))
    )
      throw new ConflictException('A preceding party must sign first');
  }
}
