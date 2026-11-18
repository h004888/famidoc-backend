import type { ContractSummary } from '../../entities/contract-change.entity';
import { calculateContractTermsHash } from '../../pricing/contract-terms-hash';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  Prisma,
  type ContractDocumensoSigner,
  type SignerRole,
  type ContractSignature,
} from '@prisma/client';
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
  type DetailedMedicalContract,
} from '../../repositories/interfaces/contracts.repository.interface';
import type {
  FindMedicalContractOptions,
  IContractsService,
} from '../interfaces/contracts.service.interface';
import type {
  CreateContractAddendumDto,
  CreatePackageUpgradeDto,
  SignContractChangeDto,
  TerminateContractDto,
} from '../../dtos/contract-change.dto';
import type {
  CreateStaffingContractDto,
  UpdateStaffingContractDto,
  SignStaffingContractDto,
  RejectStaffingContractDto,
  RequestStaffingTerminationDto,
  TerminateStaffingContractDto,
  StaffingTerminationImpactDto,
  ListStaffingContractsDto,
  StaffingContractResponseDto,
} from '../../dtos/staffing-contract.dto';
import type { CreateMedicalContractDto } from '../../dtos/create-medical-contract.dto';
import type { AssignDoctorToPackageDto } from '../../dtos/assign-doctor.dto';
import type { ListMedicalContractsQueryDto } from '../../dtos/list-medical-contracts-query.dto';
import type { CareNeedsSummaryDto, PatientCareSummaryDto } from '../../dtos/care-needs-summary.dto';
import { ContractDocumentRendererService } from '../contract-document-renderer.service';
import { ContractPaymentNoticeService } from '../contract-payment-notice.service';
import { ContractPdfRendererService } from '../contract-pdf-renderer.service';
import {
  DocumensoClientService,
  type DocumensoEnvelopeCreatedResult,
  type DocumensoRecipientInput,
} from '../documenso-client.service';
import { DocumensoSyncService } from '../documenso-sync.service';
import {
  isSignedPdfReady,
  resolveSignedPdfUrl,
} from '../contract-signed-pdf-gate';
import {
  buildDocumensoContractFieldValues,
  buildDocumensoContractHtml,
  isStrictRealPartyMode,
  validateRealPartyContractData,
} from '../../templates/build-documenso-contract-html';
import type { BuildDocumensoContractHtmlInput } from '../../templates/build-documenso-contract-html';
import {
  buildB2bStaffingContractHtml,
  normalizeB2bSupplementaryTerms,
} from '../../templates/build-b2b-staffing-contract-html';
import { resolvePlatformLegalIdentity } from '../../templates/platform-legal-identity';
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
@Injectable()
export class ContractsServiceImpl implements IContractsService {
  private readonly documentRenderer: ContractDocumentRendererService;
  private readonly logger = new Logger(ContractsServiceImpl.name);

  constructor(
    @Inject(CONTRACTS_REPOSITORY_TOKEN)
    private readonly repository: IContractsRepository,
    @Optional()
    @Inject(ContractDocumentRendererService)
    documentRenderer?: ContractDocumentRendererService,
    @Optional()
    @Inject(ContractPaymentNoticeService)
    private readonly paymentNotice?: ContractPaymentNoticeService,
    @Optional()
    @Inject(DocumensoClientService)
    private readonly documensoClient?: DocumensoClientService,
    @Optional()
    @Inject(DocumensoSyncService)
    private readonly documensoSync?: DocumensoSyncService,
    @Optional()
    @Inject(ContractPdfRendererService)
    private readonly pdfRenderer?: ContractPdfRendererService,
  ) {
    this.documentRenderer =
      documentRenderer || new ContractDocumentRendererService();
  }

  async createInitialMedicalContract(
    actor: AuthenticatedUser,
    dto: CreateMedicalContractDto,
  ): Promise<ContractSummary> {
    const patientIds = dto.patientIds ?? [];

    const validateAndPrepare = async (session: ContractsSession) => {
      let targetFamilyId = dto.familyId;
      if (actor.role === 'FAMILY_REP') {
        targetFamilyId = actor.familyUnitId || dto.familyId;
        if (!targetFamilyId) {
          const repFamily =
            await session.findFamilyByRepresentativeUserId?.(actor.id);
          targetFamilyId = repFamily?.id;
        }
        if (!targetFamilyId) {
          throw new BadRequestException(
            'Tài khoản đại diện gia đình chưa liên kết với hộ gia đình',
          );
        }
      } else if (actor.role === 'ADMIN') {
        if (!targetFamilyId) {
          throw new BadRequestException(
            'Vui lòng chỉ định hộ gia đình (familyId)',
          );
        }
      } else {
        throw new ForbiddenException(
          'Chỉ Đại diện gia đình hoặc Quản trị viên mới có quyền tạo hợp đồng',
        );
      }

      const pkg = await session.findPackage(dto.packageId);
      if (!pkg || pkg.status !== 'ACTIVE' || pkg.deletedAt) {
        throw new BadRequestException(
          'Gói chăm sóc sức khỏe không hợp lệ hoặc không khả dụng',
        );
      }

      const facility = await session.findFacilityById(dto.facilityId);
      if (!facility || facility.verificationStatus !== 'ACTIVE') {
        throw new BadRequestException(
          'Cơ sở y tế không hợp lệ hoặc chưa được kích hoạt',
        );
      }

      // Chặn sớm: thiếu hợp đồng cung ứng nhân lực B2B hiệu lực thì chắc chắn
      // không thể thanh toán/đối soát về sau, nên không được gửi phong bì ký.
      const activeStaffing = await session.findActiveStaffingContract(
        dto.facilityId,
        todayInVietnam(),
      );
      if (!activeStaffing) {
        throw new BadRequestException(
          'Cơ sở y tế chưa có hợp đồng cung ứng nhân lực B2B còn hiệu lực. Vui lòng chọn cơ sở y tế khác hoặc liên hệ Ban quản trị FamiDoc để hoàn tất hợp đồng hợp tác.',
        );
      }

      let doctor: any = null;
      if (dto.doctorId) {
        doctor = await session.findDoctorById(dto.doctorId);
        if (
          !doctor ||
          doctor.onboardingStatus !== 'ACTIVE' ||
          doctor.facilityId !== dto.facilityId
        ) {
          throw new BadRequestException(
            'Bác sĩ không hợp lệ hoặc không thuộc cơ sở y tế này',
          );
        }

        const maxCap = doctor.maxPanelCapacity || 30;
        if (
          typeof doctor.activePanelCount === 'number' &&
          doctor.activePanelCount >= maxCap
        ) {
          throw new ConflictException(
            `Bác sĩ đã đạt giới hạn tối đa số hộ gia đình phụ trách (${maxCap}/${maxCap}). Vui lòng chọn bác sĩ khác`,
          );
        }
      }

      const family = await session.findFamilyById(targetFamilyId);
      if (!family || family.status !== 'ACTIVE') {
        throw new BadRequestException(
          'Hộ gia đình không tồn tại hoặc không ở trạng thái ACTIVE',
        );
      }

      // Hợp đồng cũ chỉ được coi là thay thế hợp lệ khi còn bản nháp chưa thanh toán.
      if (dto.replaceContractId) {
        await this.requireReplaceableDraft(
          session,
          dto.replaceContractId,
          targetFamilyId,
        );
      }

      let memberCount: number;
      if (patientIds.length > 0) {
        if (
          dto.memberCount !== undefined &&
          dto.memberCount !== patientIds.length
        ) {
          throw new BadRequestException(
            'memberCount phải khớp với số thành viên trong patientIds',
          );
        }
        const patients = await session.findPatientsByIdsAndFamilyId(
          patientIds,
          targetFamilyId,
        );
        if (patients.length !== patientIds.length) {
          throw new BadRequestException(
            'Tất cả thành viên được chọn phải thuộc hộ gia đình của hợp đồng',
          );
        }
        memberCount = patientIds.length;
      } else {
        memberCount = dto.memberCount ?? 1;
        if (!Number.isInteger(memberCount) || memberCount < 1) {
          throw new BadRequestException('memberCount phải là số nguyên >= 1');
        }
      }

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

      const today = todayInVietnam();
      const contractNumber =
        'MC' + randomUUID().replaceAll('-', '').toUpperCase();
      const admin = (await session.findFirstActiveAdminUser?.()) ?? null;

      const contractInput: BuildDocumensoContractHtmlInput = {
        contractNumber,
        durationMonths: pkg.durationMonths,
        pkg,
        pricing: {
          basePriceVnd: quote.pricing.basePriceVnd,
          additionalMemberTotalVnd: quote.pricing.additionalMembersTotalVnd,
          additionalMemberUnitPriceVnd: moneyToNumber(
            pkg.additionalMemberMonthlyPrice,
          ),
          totalPriceVnd: quote.pricing.totalPriceVnd,
        },
        memberCount,
        family,
        facility,
        doctor,
        admin,
        additionalTerms: dto.additionalTerms,
      };

      this.assertRealPartyDataIfStrict(contractInput);

      return {
        targetFamilyId,
        pkg,
        facility,
        doctor,
        family,
        admin,
        memberCount,
        quote,
        snapshot,
        today,
        contractNumber,
        contractInput,
      };
    };

    let replacedEnvelopeId: string | null = null;
    const persistContract = async (
      session: ContractsSession,
      prepared: Awaited<ReturnType<typeof validateAndPrepare>>,
      documensoEnvelope: DocumensoEnvelopeCreatedResult | null,
    ): Promise<ContractSummary> => {
      // Hủy nguyên tử hợp đồng cũ ngay trước khi tạo mới để không sinh bản nháp trùng.
      if (dto.replaceContractId) {
        const replaced = await this.requireReplaceableDraft(
          session,
          dto.replaceContractId,
          prepared.targetFamilyId,
        );
        replacedEnvelopeId = replaced.documensoEnvelopeId ?? null;
        await this.terminateUnpaidDraft(
          session,
          replaced,
          'Thay thế bằng hợp đồng mới do thay đổi gói hoặc số thành viên',
          actor.id,
          'REPLACE_UNPAID_CONTRACT_DRAFT',
        );
      }

      const createFn = session.createMedicalContract || session.createUpgrade;
      const item = await createFn.call(session, {
        contractNumber: prepared.contractNumber,
        familyId: prepared.targetFamilyId,
        facilityId: dto.facilityId,
        doctorId: dto.doctorId ?? null,
        packageId: prepared.pkg.id,
        totalAmount: prepared.quote.pricing.totalPriceVnd,
        remainingHomeVisits: prepared.pkg.periodicVisitsQuota,
        remainingTelehealth: prepared.pkg.telehealthQuota,
        startDate: prepared.today,
        endDate: addContractMonths(prepared.today, prepared.pkg.durationMonths),
        contractStatus: 'PENDING_APPROVAL',
        billingSnapshot: prepared.snapshot as unknown as Prisma.InputJsonValue,
        memberCount: prepared.memberCount,
        isDemo: false,
        additionalTerms: dto.additionalTerms?.trim() || null,
        documensoEnvelopeId: documensoEnvelope?.envelopeId ?? null,
        documensoItemId: documensoEnvelope?.envelopeItemId ?? null,
      });

      if (documensoEnvelope) {
        await this.saveDocumensoSignersForContract(
          session,
          item.id,
          documensoEnvelope.signers,
        );
      }

      if (patientIds.length > 0) {
        await session.createContractMembers(item.id, patientIds);
      }

      await session.recordChange(
        actor.id,
        item,
        'CREATE_INITIAL_MEDICAL_CONTRACT',
        item.id,
      );

      const familySigner = documensoEnvelope?.signers.find(
        (s) => s.role === 'FAMILY_REP',
      );

      return {
        ...this.toContractSummary(item),
        documensoEnvelopeId: documensoEnvelope?.envelopeId ?? null,
        documensoItemId: documensoEnvelope?.envelopeItemId ?? null,
        signingToken: familySigner?.token ?? null,
        signingUrl: familySigner?.signingUrl ?? null,
        additionalTerms: dto.additionalTerms?.trim() || null,
      };
    };

    if (!this.documensoClient) {
      const created = await this.repository.transaction(async (session) => {
        const prepared = await validateAndPrepare(session);
        return persistContract(session, prepared, null);
      });
      await this.deleteEnvelopeSafely(replacedEnvelopeId);
      return created;
    }

    const prepared = await this.repository.transaction(validateAndPrepare);
    const recipients = this.buildDocumensoRecipients({
      family: prepared.family,
      facility: prepared.facility,
      doctor: prepared.doctor,
      admin: prepared.admin,
      familyId: prepared.targetFamilyId,
      facilityId: prepared.facility.id,
    });
    const documensoEnvelope = await this.provisionDocumensoEnvelope(
      prepared.contractNumber,
      prepared.contractInput,
      recipients,
    );

    let created: ContractSummary;
    try {
      created = await this.repository.transaction((session) =>
        persistContract(session, prepared, documensoEnvelope),
      );
    } catch (error) {
      await this.deleteEnvelopeSafely(documensoEnvelope.envelopeId);
      throw error;
    }
    await this.deleteEnvelopeSafely(replacedEnvelopeId);
    return created;
  }

  async signInitialMedicalContract(
    actor: AuthenticatedUser,
    id: string,
    dto: SignContractChangeDto,
    ip: string,
  ): Promise<ContractSignature> {
    const result = await this.repository.transaction(async (session) => {
      const contract = await this.requirePartyContract(session, id, actor);
      if (
        !['PENDING_APPROVAL', 'PENDING_PAYMENT'].includes(
          contract.contractStatus,
        )
      ) {
        throw new ConflictException('Contract is not awaiting signatures');
      }

      const hash = calculateContractTermsHash(contract);
      this.validateAcceptance(dto, hash);

      const role = getContractSignerRole(contract, actor);
      if (
        ['HEALTHCARE_FACILITY', 'ASSIGNED_DOCTOR'].includes(role) &&
        contract.doctorId === null
      ) {
        throw new BadRequestException(
          'Cơ sở y tế phải phân công bác sĩ trước khi ký tiếp nhận',
        );
      }
      const signatures = await session.findContractSignatures(id);

      const previous = signatures.find((s) => s.signerRole === role);
      if (previous) {
        if (previous.signerUserId !== actor.id) {
          throw new ConflictException('This role has already signed');
        }
        // Ký lại không phải chữ ký thứ tư: không phát sinh thêm email thông báo.
        return { item: previous, isFourthSignature: false };
      }

      this.assertSigningOrder(
        role,
        signatures.map((s) => s.signerRole),
      );

      const saveSigFn = session.saveSignature || session.saveUpgradeSignature;
      const item = await saveSigFn.call(session, {
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

      const isFourthSignature = signatures.length === 3;
      if (isFourthSignature) {
        await session.updateContractStatus(id, 'PENDING_PAYMENT');
      }

      await session.recordChange(
        actor.id,
        contract,
        'SIGN_INITIAL_MEDICAL_CONTRACT',
        id,
      );

      return { item, isFourthSignature };
    });

    if (result.isFourthSignature) {
      // Gọi ngoài transaction: transaction có thể thử lại và không được chứa I/O.
      // Notifier tự bắt lỗi; bọc thêm ở đây để chữ ký đã commit không bao giờ bị báo thất bại.
      try {
        await this.paymentNotice?.sendPaymentNotice(id);
      } catch (error) {
        this.logger.error(
          `Không gửi được email thông báo thanh toán cho hợp đồng ${id}: ${(error as Error)?.message ?? error}`,
        );
      }
    }

    return result.item;
  }

  initiateFourPartyContract(
    actor: AuthenticatedUser,
    dto: CreateMedicalContractDto,
  ): Promise<ContractSummary> {
    return this.createInitialMedicalContract(actor, dto);
  }

  async cancelDraftMedicalContract(
    actor: AuthenticatedUser,
    id: string,
    reason?: string,
  ): Promise<{ id: string; contractStatus: 'TERMINATED' }> {
    if (!['FAMILY_REP', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException(
        'Chỉ Đại diện gia đình hoặc Quản trị viên mới có quyền hủy bản nháp hợp đồng',
      );
    }
    const contract = await this.repository.transaction(async (session) => {
      const target = await session.findContractForUpdate(id);
      if (!target) throw new NotFoundException('Không tìm thấy hợp đồng y tế');
      let allowedFamilyId: string | null = target.familyId;
      if (actor.role !== 'ADMIN') {
        allowedFamilyId =
          actor.familyUnitId ??
          (await session.findFamilyByRepresentativeUserId?.(actor.id))?.id ??
          null;
        if (!allowedFamilyId) {
          throw new ForbiddenException(
            'Tài khoản đại diện gia đình chưa liên kết với hộ gia đình',
          );
        }
      }
      const replaceable = await this.requireReplaceableDraft(
        session,
        id,
        allowedFamilyId,
      );
      await this.terminateUnpaidDraft(
        session,
        replaceable,
        reason?.trim() ||
          (actor.role === 'ADMIN'
            ? 'Quản trị viên hủy bản nháp hợp đồng chưa thanh toán'
            : 'Đại diện hộ gia đình hủy bản nháp hợp đồng chưa thanh toán'),
        actor.id,
        'CANCEL_UNPAID_CONTRACT_DRAFT',
      );
      return replaceable;
    });
    // Documenso nằm ngoài transaction: lỗi phía đối tác chỉ ghi cảnh báo, bản nháp nội bộ đã đóng.
    await this.deleteEnvelopeSafely(contract.documensoEnvelopeId);
    return { id: contract.id, contractStatus: 'TERMINATED' };
  }

  private async deleteEnvelopeSafely(envelopeId?: string | null) {
    if (!envelopeId || !this.documensoClient?.deleteEnvelope) return;
    try {
      await this.documensoClient.deleteEnvelope(envelopeId);
    } catch (error) {
      this.logger.warn(
        `Không hủy được phong bì Documenso ${envelopeId}: ${
          (error as Error)?.message ?? error
        }`,
      );
    }
  }

  signFourPartyContract(
    actor: AuthenticatedUser,
    id: string,
    dto: SignContractChangeDto,
    ip: string,
  ): Promise<ContractSignature> {
    return this.signInitialMedicalContract(actor, id, dto, ip);
  }

  assignDoctorToPackage(
    actor: AuthenticatedUser,
    contractId: string,
    dto: AssignDoctorToPackageDto,
    _ip: string,
  ): Promise<ContractSummary> {
    return this.repository.transaction(async (session) => {
      const contract = await session.findContractForUpdate(contractId);
      if (!contract) {
        throw new NotFoundException('Không tìm thấy hợp đồng y tế');
      }

      if (actor.role === 'HEALTHCARE_FACILITY') {
        if (contract.facility.userId !== actor.id) {
          throw new ForbiddenException(
            'Bạn không có quyền phân công bác sĩ cho hợp đồng của cơ sở y tế khác',
          );
        }
      } else if (actor.role !== 'ADMIN') {
        throw new ForbiddenException(
          'Chỉ Cơ sở y tế hoặc Quản trị viên mới có quyền phân công bác sĩ',
        );
      }

      if (['TERMINATED', 'EXPIRED'].includes(contract.contractStatus)) {
        throw new ConflictException(
          'Hợp đồng đã kết thúc hoặc bị hủy, không thể phân công lại bác sĩ',
        );
      }

      const newDoctor = await session.findDoctorById(dto.doctorId);
      if (!newDoctor || newDoctor.onboardingStatus !== 'ACTIVE') {
        throw new BadRequestException(
          'Bác sĩ không tồn tại hoặc chưa được kích hoạt hoạt động',
        );
      }

      if (newDoctor.facilityId !== contract.facilityId) {
        throw new BadRequestException(
          'Bác sĩ không thuộc cơ sở y tế phụ trách hợp đồng này',
        );
      }

      const maxCapacity = newDoctor.maxPanelCapacity || 30;
      if (
        typeof newDoctor.activePanelCount === 'number' &&
        newDoctor.activePanelCount >= maxCapacity
      ) {
        throw new ConflictException(
          `Bác sĩ đã đạt giới hạn tối đa số hộ gia đình phụ trách (${maxCapacity}/${maxCapacity}). Vui lòng chọn bác sĩ khác`,
        );
      }

      const prevDoctorId = contract.doctorId;
      if (prevDoctorId === dto.doctorId) {
        return this.toContractSummary(contract);
      }

      const updated = await session.updateContractDoctor(
        contractId,
        dto.doctorId,
      );

      // Nếu hợp đồng đang ACTIVE thì cập nhật counter activePanelCount (BR-03)
      if (contract.contractStatus === 'ACTIVE') {
        if (prevDoctorId) await session.refreshDoctorPanel(prevDoctorId);
        await session.refreshDoctorPanel(dto.doctorId);
      }

      await session.recordChange(
        actor.id,
        updated,
        'ASSIGN_DOCTOR_TO_CONTRACT',
        contractId,
      );

      return this.toContractSummary(updated);
    });
  }

  private assertStaffingRatesAndDates(
    platformCommissionRate: number,
    facilityRevenueRate: number,
    startDateInput: string | Date,
    endDateInput: string | Date,
  ): { startDate: Date; endDate: Date } {
    if (
      Math.round((platformCommissionRate + facilityRevenueRate) * 100) / 100 !==
      100.0
    ) {
      throw new BadRequestException(
        'Tổng tỷ lệ hoa hồng nền tảng và doanh thu cơ sở y tế phải đúng bằng 100%',
      );
    }

    const startDate = new Date(startDateInput);
    const endDate = new Date(endDateInput);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException('Ngày bắt đầu hoặc kết thúc không hợp lệ');
    }
    if (endDate <= startDate) {
      throw new BadRequestException(
        'Ngày kết thúc hợp đồng phải sau ngày bắt đầu',
      );
    }
    return { startDate, endDate };
  }

  private async requireStaffingParty(
    session: ContractsSession,
    id: string,
    actor: AuthenticatedUser,
    options?: { lock?: boolean },
  ) {
    const contract =
      options?.lock && session.lockStaffingContractForUpdate
        ? await session.lockStaffingContractForUpdate(id)
        : await session.findStaffingContract(id);
    if (!contract) {
      throw new NotFoundException(
        'Không tìm thấy hợp đồng cung ứng nhân lực',
      );
    }

    if (actor.role === 'HEALTHCARE_FACILITY') {
      if (contract.facility.userId !== actor.id) {
        throw new ForbiddenException(
          'Bạn không có quyền thao tác với hợp đồng của cơ sở y tế khác',
        );
      }
    } else if (actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Chỉ Quản trị viên hoặc Đại diện CSYT mới có quyền truy cập hợp đồng nhân lực',
      );
    }

    return contract;
  }

  private async safeDeleteDocumensoEnvelope(envelopeId?: string | null) {
    if (!envelopeId || !this.documensoClient?.deleteEnvelope) return;
    try {
      await this.documensoClient.deleteEnvelope(envelopeId);
    } catch (error) {
      this.logger.warn(
        `Không thể xóa envelope Documenso ${envelopeId} (tiếp tục xử lý): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async provisionB2bDocumensoEnvelope(params: {
    contractId: string;
    contractCode: string;
    createdAt?: Date | string;
    facility: any;
    adminUser: { email: string; fullName: string };
    platformCommissionRate: number;
    facilityRevenueRate: number;
    startDate: Date;
    endDate: Date;
    contractTerms?: string | null;
  }): Promise<{
    documensoEnvelopeId: string | null;
    documensoItemId: string | null;
    facilityDocumensoRecipientId: number | null;
    facilitySigningUrl: string | null;
    facilitySigningToken: string | null;
    adminDocumensoRecipientId: number | null;
    adminSigningUrl: string | null;
    adminSigningToken: string | null;
  }> {
    if (!this.isDocumensoConfigured() || !this.documensoClient?.createTwoPartyEnvelope) {
      return {
        documensoEnvelopeId: null,
        documensoItemId: null,
        facilityDocumensoRecipientId: null,
        facilitySigningUrl: null,
        facilitySigningToken: null,
        adminDocumensoRecipientId: null,
        adminSigningUrl: null,
        adminSigningToken: null,
      };
    }

    const facilityEmail =
      params.facility.user?.email ||
      `facility-${params.facility.id.slice(0, 8)}@famidoc.local`;
    const adminEmail = params.adminUser.email || 'admin@famidoc.vn';
    const html = buildB2bStaffingContractHtml({
      contractNumber: params.contractCode,
      createdAt: params.createdAt,
      facilityName: params.facility.facilityName,
      facilityLicenseNumber: params.facility.licenseNumber,
      facilityLicenseIssuer: params.facility.licenseIssuer,
      facilityLicenseDate: params.facility.licenseDate,
      facilityTaxCode: params.facility.taxCode,
      facilityAddress: params.facility.address,
      facilityRepresentativeName:
        params.facility.user?.fullName || params.facility.facilityName,
      facilityEmail,
      facilityPhone: params.facility.user?.phone || params.facility.hotline,
      facilityHotline: params.facility.hotline,
      facilityBankName: params.facility.bankName,
      facilityBankAccountNumber: params.facility.bankAccountNumber,
      facilityBankAccountHolder: params.facility.bankAccountHolder,
      platformCommissionRate: params.platformCommissionRate,
      facilityRevenueRate: params.facilityRevenueRate,
      startDate: params.startDate,
      endDate: params.endDate,
      contractTerms: params.contractTerms,
      admin: params.adminUser,
    });

    const pdfRenderer = this.pdfRenderer || new ContractPdfRendererService();
    const pdfBuffer = await pdfRenderer.renderPdf(html);
    const envelope = await this.documensoClient.createTwoPartyEnvelope({
      contractId: params.contractId,
      contractNumber: params.contractCode,
      pdfBuffer,
      recipients: [
        {
          role: 'HEALTHCARE_FACILITY',
          email: facilityEmail,
          name: params.facility.user?.fullName || params.facility.facilityName,
        },
        {
          role: 'ADMIN',
          email: adminEmail,
          name: params.adminUser.fullName || 'Đại diện Nền tảng FamiDoc',
        },
      ],
    });

    const facilitySigner = envelope.signers.find(
      (s) => s.role === 'HEALTHCARE_FACILITY',
    );
    const adminSigner = envelope.signers.find((s) => s.role === 'ADMIN');

    return {
      documensoEnvelopeId: envelope.envelopeId,
      documensoItemId: envelope.envelopeItemId,
      facilityDocumensoRecipientId: facilitySigner?.recipientId ?? null,
      facilitySigningUrl: facilitySigner?.signingUrl ?? null,
      facilitySigningToken: facilitySigner?.token ?? null,
      adminDocumensoRecipientId: adminSigner?.recipientId ?? null,
      adminSigningUrl: adminSigner?.signingUrl ?? null,
      adminSigningToken: adminSigner?.token ?? null,
    };
  }

  private buildStaffingImpactDto(
    contract: { id: string; facilityId: string; status: any },
    counts: {
      activeMedicalContracts: number;
      pendingMedicalContracts: number;
      openEncounters: number;
      unsettledSettlements: number;
      unsettledPaidInvoices: number;
      activeOrOnboardingDoctors: number;
      openComplaints: number;
    },
  ): StaffingTerminationImpactDto {
    const warnings: string[] = [];
    if (counts.activeMedicalContracts > 0) {
      warnings.push(
        `Cơ sở đang phụ trách ${counts.activeMedicalContracts} hợp đồng chăm sóc gia đình ACTIVE.`,
      );
    }
    if (counts.pendingMedicalContracts > 0) {
      warnings.push(
        `Có ${counts.pendingMedicalContracts} hợp đồng 4 bên đang chờ ký hoặc chờ thanh toán.`,
      );
    }
    if (counts.openEncounters > 0) {
      warnings.push(
        `Có ${counts.openEncounters} lượt khám / lịch hẹn đang mở hoặc đang thực hiện.`,
      );
    }
    if (counts.unsettledSettlements > 0 || counts.unsettledPaidInvoices > 0) {
      warnings.push(
        `Còn ${counts.unsettledSettlements} kỳ quyết toán chưa chi trả xong và ${counts.unsettledPaidInvoices} hóa đơn đã thu chưa quyết toán.`,
      );
    }
    if (counts.activeOrOnboardingDoctors > 0) {
      warnings.push(
        `Có ${counts.activeOrOnboardingDoctors} bác sĩ đang hoạt động hoặc đang thẩm định thuộc cơ sở này.`,
      );
    }
    if (counts.openComplaints > 0) {
      warnings.push(
        `Có ${counts.openComplaints} khiếu nại đang chờ xử lý / điều tra.`,
      );
    }

    const hasBlockingDependencies =
      counts.activeMedicalContracts > 0 ||
      counts.pendingMedicalContracts > 0 ||
      counts.openEncounters > 0;

    return {
      contractId: contract.id,
      facilityId: contract.facilityId,
      status: contract.status,
      ...counts,
      hasBlockingDependencies,
      warnings,
    };
  }

  async createStaffingContract(
    actor: AuthenticatedUser,
    dto: CreateStaffingContractDto,
    ip: string,
  ): Promise<StaffingContractResponseDto> {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Chỉ Quản trị viên nền tảng mới có quyền khởi tạo hợp đồng B2B cho cơ sở y tế',
      );
    }

    const platformCommissionRate = dto.platformCommissionRate ?? 15.0;
    const facilityRevenueRate = dto.facilityRevenueRate ?? 85.0;
    const { startDate, endDate } = this.assertStaffingRatesAndDates(
      platformCommissionRate,
      facilityRevenueRate,
      dto.startDate,
      dto.endDate,
    );

    const prep = await this.repository.transaction(async (session) => {
      if (!dto.facilityId) {
        throw new BadRequestException(
          'Vui lòng chỉ định cơ sở y tế đối tác (facilityId)',
        );
      }
      const facility = await session.findFacilityById(dto.facilityId);
      if (!facility || facility.verificationStatus !== 'ACTIVE') {
        throw new BadRequestException(
          'Cơ sở y tế không tồn tại hoặc chưa được kích hoạt hoạt động',
        );
      }

      const conflict = await session.findConflictingStaffingContract(
        facility.id,
        startDate,
        endDate,
      );
      if (conflict) {
        throw new ConflictException(
          'Cơ sở y tế đã có hợp đồng cung ứng nhân lực hiệu lực hoặc đang trong quy trình ký/chỉnh sửa trong khoảng thời gian này',
        );
      }

      const adminUser = (await session.findFirstActiveAdminUser?.()) ?? {
        id: actor.id,
        email: 'admin@famidoc.vn',
        fullName: 'Đại diện Nền tảng FamiDoc',
      };

      return { facility, adminUser };
    });

    const contractId = randomUUID();
    const year = new Date().getFullYear();
    const randomSuffix = contractId.substring(0, 8).toUpperCase();
    const contractCode = `STF-${year}-${randomSuffix}`;
    const contractTerms = normalizeB2bSupplementaryTerms(dto.contractTerms);

    const envelopeFields = await this.provisionB2bDocumensoEnvelope({
      contractId,
      contractCode,
      createdAt: new Date(),
      facility: prep.facility,
      adminUser: prep.adminUser,
      platformCommissionRate,
      facilityRevenueRate,
      startDate,
      endDate,
      contractTerms,
    });

    try {
      return await this.repository.transaction(async (session) => {
        const created = await session.createStaffingContract({
          id: contractId,
          contractCode,
          facilityId: prep.facility.id,
          platformCommissionRate: new Prisma.Decimal(platformCommissionRate),
          facilityRevenueRate: new Prisma.Decimal(facilityRevenueRate),
          startDate,
          endDate,
          contractTerms,
          signedPdfUrl: dto.signedPdfUrl || null,
          ...envelopeFields,
          status: 'PENDING_FACILITY_SIGNATURE',
        });

        await session.recordStaffingAudit(
          actor.id,
          'STAFFING_CONTRACT_CREATED',
          created.id,
          ip,
        );

        if (prep.facility.userId) {
          await session.createNotification({
            userId: prep.facility.userId,
            title: 'Hợp đồng B2B mới chờ xem xét & ký số',
            content: `Quản trị viên đã khởi tạo hợp đồng cung ứng nhân lực B2B ${contractCode}. Vui lòng xem xét điều khoản và ký số hoặc gửi yêu cầu chỉnh sửa.`,
            type: 'STAFFING_CONTRACT_CREATED',
          });
        }

        return this.formatStaffingContract(created);
      });
    } catch (error) {
      await this.safeDeleteDocumensoEnvelope(envelopeFields.documensoEnvelopeId);
      throw error;
    }
  }

  async updateStaffingContract(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateStaffingContractDto,
    ip: string,
  ): Promise<StaffingContractResponseDto> {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Chỉ Quản trị viên nền tảng mới có quyền chỉnh sửa hợp đồng B2B',
      );
    }

    const prep = await this.repository.transaction(async (session) => {
      const contract = await this.requireStaffingParty(session, id, actor);
      if (
        !['REVISION_REQUESTED', 'PENDING_FACILITY_SIGNATURE'].includes(
          contract.status,
        )
      ) {
        throw new ConflictException(
          'Chỉ có thể chỉnh sửa hợp đồng khi đang chờ CSYT phản hồi/ký hoặc đang ở trạng thái yêu cầu chỉnh sửa',
        );
      }

      const nextPlatformRate =
        dto.platformCommissionRate ?? Number(contract.platformCommissionRate);
      const nextFacilityRate =
        dto.facilityRevenueRate ?? Number(contract.facilityRevenueRate);
      const { startDate, endDate } = this.assertStaffingRatesAndDates(
        nextPlatformRate,
        nextFacilityRate,
        dto.startDate ?? contract.startDate,
        dto.endDate ?? contract.endDate,
      );

      const conflict = await session.findConflictingStaffingContract(
        contract.facilityId,
        startDate,
        endDate,
        contract.id,
      );
      if (conflict) {
        throw new ConflictException(
          'Thời hạn hiệu lực mới bị trùng với một hợp đồng B2B khác của cơ sở y tế',
        );
      }

      const adminUser = (await session.findFirstActiveAdminUser?.()) ?? {
        id: actor.id,
        email: 'admin@famidoc.vn',
        fullName: 'Đại diện Nền tảng FamiDoc',
      };

      return {
        contract,
        adminUser,
        platformCommissionRate: nextPlatformRate,
        facilityRevenueRate: nextFacilityRate,
        startDate,
        endDate,
        contractTerms:
          dto.contractTerms !== undefined
            ? normalizeB2bSupplementaryTerms(dto.contractTerms)
            : normalizeB2bSupplementaryTerms(contract.contractTerms),
      };
    });

    await this.safeDeleteDocumensoEnvelope(prep.contract.documensoEnvelopeId);

    const envelopeFields = await this.provisionB2bDocumensoEnvelope({
      contractId: prep.contract.id,
      contractCode: prep.contract.contractCode,
      createdAt: prep.contract.createdAt,
      facility: prep.contract.facility,
      adminUser: prep.adminUser,
      platformCommissionRate: prep.platformCommissionRate,
      facilityRevenueRate: prep.facilityRevenueRate,
      startDate: prep.startDate,
      endDate: prep.endDate,
      contractTerms: prep.contractTerms,
    });

    try {
      return await this.repository.transaction(async (session) => {
        const updated = session.updateStaffingContract
          ? await session.updateStaffingContract(id, {
              platformCommissionRate: new Prisma.Decimal(
                prep.platformCommissionRate,
              ),
              facilityRevenueRate: new Prisma.Decimal(prep.facilityRevenueRate),
              startDate: prep.startDate,
              endDate: prep.endDate,
              contractTerms: prep.contractTerms,
              revisionReason: null,
              facilitySignedAt: null,
              adminSignedAt: null,
              signedPdfUrl: null,
              ...envelopeFields,
              status: 'PENDING_FACILITY_SIGNATURE',
            })
          : await session.updateStaffingContractStatus(
              id,
              'PENDING_FACILITY_SIGNATURE',
            );

        await session.recordStaffingAudit(
          actor.id,
          'STAFFING_CONTRACT_REVISED',
          id,
          ip,
        );

        if (prep.contract.facility.userId) {
          await session.createNotification({
            userId: prep.contract.facility.userId,
            title: 'Hợp đồng B2B đã được điều chỉnh — Mời xem xét & ký lại',
            content: `Quản trị viên đã cập nhật điều khoản hợp đồng B2B ${prep.contract.contractCode} theo góp ý. Vui lòng kiểm tra và ký số để tiếp tục.`,
            type: 'STAFFING_CONTRACT_REVISED',
          });
        }

        return this.formatStaffingContract(updated);
      });
    } catch (error) {
      await this.safeDeleteDocumensoEnvelope(envelopeFields.documensoEnvelopeId);
      throw error;
    }
  }

  async signStaffingContract(
    actor: AuthenticatedUser,
    id: string,
    dto: SignStaffingContractDto,
    ip: string,
  ): Promise<StaffingContractResponseDto> {
    return this.repository.transaction(async (session) => {
      const contract = await this.requireStaffingParty(session, id, actor, {
        lock: true,
      });

      if (new Date(contract.endDate) < new Date()) {
        throw new BadRequestException(
          'Không thể ký hợp đồng đã quá hạn kết thúc',
        );
      }

      if (actor.role === 'HEALTHCARE_FACILITY') {
        if (contract.status !== 'PENDING_FACILITY_SIGNATURE') {
          throw new ConflictException(
            'Hợp đồng không ở trạng thái chờ Cơ sở y tế ký',
          );
        }

        const updated = session.updateStaffingContract
          ? await session.updateStaffingContract(id, {
              facilitySignedAt: new Date(),
              status: 'PENDING_ADMIN_SIGNATURE',
              ...(dto.signedPdfUrl ? { signedPdfUrl: dto.signedPdfUrl } : {}),
            })
          : await session.updateStaffingContractStatus(
              id,
              'PENDING_ADMIN_SIGNATURE',
              dto.signedPdfUrl,
            );

        await session.recordStaffingAudit(
          actor.id,
          'STAFFING_CONTRACT_FACILITY_SIGNED',
          id,
          ip,
        );

        const admins = await session.findAdminUsers();
        for (const admin of admins) {
          await session.createNotification({
            userId: admin.id,
            title: 'CSYT đã ký hợp đồng B2B — Chờ Admin ký kích hoạt',
            content: `${contract.facility.facilityName} đã ký hợp đồng B2B ${contract.contractCode}. Vui lòng ký bước 2 để kích hoạt hợp đồng.`,
            type: 'STAFFING_CONTRACT_FACILITY_SIGNED',
          });
        }

        return this.formatStaffingContract(updated);
      }

      if (contract.status === 'PENDING_FACILITY_SIGNATURE') {
        throw new ConflictException(
          'Cơ sở y tế phải ký trước trước khi Quản trị viên ký kích hoạt.',
        );
      }
      if (contract.status !== 'PENDING_ADMIN_SIGNATURE') {
        throw new ConflictException(
          'Hợp đồng không ở trạng thái chờ Quản trị viên ký kích hoạt',
        );
      }

      const signedPdfUrl = dto.signedPdfUrl || contract.signedPdfUrl;
      if (!signedPdfUrl) {
        throw new BadRequestException(
          'Cần hoàn tất ký Documenso hoặc đính kèm link HTTPS của bản hợp đồng B2B đã ký.',
        );
      }

      const updated = session.updateStaffingContract
        ? await session.updateStaffingContract(id, {
            adminSignedAt: new Date(),
            status: 'ACTIVE',
            signedPdfUrl,
          })
        : await session.updateStaffingContractStatus(id, 'ACTIVE', signedPdfUrl);

      await session.recordStaffingAudit(
        actor.id,
        'STAFFING_CONTRACT_SIGNED',
        id,
        ip,
      );

      if (contract.facility.userId) {
        await session.createNotification({
          userId: contract.facility.userId,
          title: 'Hợp đồng B2B đã chính thức có hiệu lực',
          content: `Hợp đồng B2B ${contract.contractCode} đã được cả hai bên ký hoàn tất. Bạn có thể bắt đầu tạo tài khoản bác sĩ.`,
          type: 'STAFFING_CONTRACT_ACTIVE',
        });
      }

      return this.formatStaffingContract(updated);
    });
  }

  async requestStaffingRevision(
    actor: AuthenticatedUser,
    id: string,
    dto: RejectStaffingContractDto,
    ip: string,
  ): Promise<StaffingContractResponseDto> {
    if (actor.role !== 'HEALTHCARE_FACILITY') {
      throw new ForbiddenException(
        'Chỉ đại diện Cơ sở y tế mới có quyền gửi yêu cầu chỉnh sửa hợp đồng B2B',
      );
    }

    const reason = (dto.rejectionReason ?? dto.reason ?? '').trim();
    if (reason.length < 5) {
      throw new BadRequestException(
        'Vui lòng nhập lý do yêu cầu chỉnh sửa tối thiểu 5 ký tự',
      );
    }

    const { contract } = await this.repository.transaction(async (session) => {
      const existing = await this.requireStaffingParty(session, id, actor);
      if (existing.status !== 'PENDING_FACILITY_SIGNATURE') {
        throw new ConflictException(
          'Chỉ có thể yêu cầu chỉnh sửa khi hợp đồng đang ở trạng thái chờ CSYT ký (PENDING_FACILITY_SIGNATURE)',
        );
      }
      return { contract: existing };
    });

    await this.safeDeleteDocumensoEnvelope(contract.documensoEnvelopeId);

    return this.repository.transaction(async (session) => {
      const updated = session.updateStaffingContract
        ? await session.updateStaffingContract(id, {
            status: 'REVISION_REQUESTED',
            revisionReason: reason,
            documensoEnvelopeId: null,
            documensoItemId: null,
            facilityDocumensoRecipientId: null,
            facilitySigningUrl: null,
            facilitySigningToken: null,
            adminDocumensoRecipientId: null,
            adminSigningUrl: null,
            adminSigningToken: null,
            facilitySignedAt: null,
            adminSignedAt: null,
          })
        : await session.updateStaffingContractStatus(id, 'REVISION_REQUESTED');

      await session.recordStaffingAudit(
        actor.id,
        'STAFFING_CONTRACT_REVISION_REQUESTED',
        id,
        ip,
      );

      const admins = await session.findAdminUsers();
      for (const admin of admins) {
        await session.createNotification({
          userId: admin.id,
          title: 'CSYT yêu cầu chỉnh sửa dự thảo hợp đồng B2B',
          content: `Cơ sở y tế ${contract.facility.facilityName} yêu cầu chỉnh sửa hợp đồng ${contract.contractCode}. Lý do: ${reason}`,
          type: 'STAFFING_CONTRACT_REVISION_REQUESTED',
        });
      }

      return this.formatStaffingContract(updated);
    });
  }

  async rejectStaffingContract(
    actor: AuthenticatedUser,
    id: string,
    dto: RejectStaffingContractDto,
    ip: string,
  ): Promise<StaffingContractResponseDto> {
    return this.requestStaffingRevision(actor, id, dto, ip);
  }

  async getStaffingSigningSession(actor: AuthenticatedUser, id: string) {
    const initial = await this.repository.transaction(async (session) => {
      const contract = await this.requireStaffingParty(session, id, actor);
      const role: 'HEALTHCARE_FACILITY' | 'ADMIN' =
        actor.role === 'ADMIN' ? 'ADMIN' : 'HEALTHCARE_FACILITY';

      const needsLazyProvision =
        contract.status === 'PENDING_FACILITY_SIGNATURE' &&
        !contract.documensoEnvelopeId &&
        this.isDocumensoConfigured();

      if (needsLazyProvision) {
        const adminUser = (await session.findFirstActiveAdminUser?.()) ?? {
          id: actor.id,
          email: 'admin@famidoc.vn',
          fullName: 'Đại diện Nền tảng FamiDoc',
        };
        return {
          mode: 'LAZY_PROVISION' as const,
          contract,
          role,
          adminUser,
        };
      }

      return {
        mode: 'DIRECT' as const,
        contract,
        role,
      };
    });

    let contract = initial.contract;
    if (initial.mode === 'LAZY_PROVISION') {
      const envelopeFields = await this.provisionB2bDocumensoEnvelope({
        contractId: contract.id,
        contractCode: contract.contractCode,
        createdAt: contract.createdAt,
        facility: contract.facility,
        adminUser: initial.adminUser,
        platformCommissionRate: Number(contract.platformCommissionRate),
        facilityRevenueRate: Number(contract.facilityRevenueRate),
        startDate: contract.startDate,
        endDate: contract.endDate,
        contractTerms: normalizeB2bSupplementaryTerms(contract.contractTerms),
      });

      if (envelopeFields.documensoEnvelopeId) {
        contract = await this.repository.transaction(async (session) => {
          const locked = await this.requireStaffingParty(session, id, actor, {
            lock: true,
          });
          if (locked.documensoEnvelopeId || !session.updateStaffingContract) {
            return locked;
          }
          return session.updateStaffingContract(id, envelopeFields);
        });
      }
    }

    const facilitySigned =
      Boolean(contract.facilitySignedAt) ||
      contract.status === 'PENDING_ADMIN_SIGNATURE' ||
      contract.status === 'ACTIVE';
    const adminSigned =
      Boolean(contract.adminSignedAt) || contract.status === 'ACTIVE';
    const signerRole = initial.role;
    const alreadySigned =
      signerRole === 'HEALTHCARE_FACILITY' ? facilitySigned : adminSigned;

    let canSign = false;
    let waitingReason: string | undefined;

    if (contract.status === 'REVISION_REQUESTED') {
      waitingReason =
        'Hợp đồng đang chờ Quản trị viên chỉnh sửa điều khoản theo phản hồi của Cơ sở y tế.';
    } else if (contract.status === 'TERMINATED' || contract.status === 'EXPIRED') {
      waitingReason = 'Hợp đồng đã chấm dứt hoặc hết hiệu lực.';
    } else if (signerRole === 'HEALTHCARE_FACILITY') {
      canSign =
        contract.status === 'PENDING_FACILITY_SIGNATURE' && !facilitySigned;
      if (!canSign && !facilitySigned) {
        waitingReason = 'Hợp đồng hiện không ở bước chờ Cơ sở y tế ký.';
      }
    } else {
      canSign = contract.status === 'PENDING_ADMIN_SIGNATURE' && !adminSigned;
      if (!canSign && !adminSigned) {
        waitingReason =
          contract.status === 'PENDING_FACILITY_SIGNATURE'
            ? 'Cần Cơ sở y tế ký bước 1 trước khi Quản trị viên ký kích hoạt.'
            : 'Hợp đồng hiện không ở bước chờ Quản trị viên ký.';
      }
    }

    const signingToken = canSign
      ? signerRole === 'HEALTHCARE_FACILITY'
        ? contract.facilitySigningToken ?? null
        : contract.adminSigningToken ?? null
      : null;
    const signingUrl = canSign
      ? signerRole === 'HEALTHCARE_FACILITY'
        ? contract.facilitySigningUrl ?? null
        : contract.adminSigningUrl ?? null
      : null;

    return {
      contractId: contract.id,
      contractCode: contract.contractCode,
      status: contract.status,
      signerRole,
      alreadySigned,
      canSign,
      ...(waitingReason ? { waitingReason } : {}),
      signingToken,
      signingUrl,
      facilitySigned,
      adminSigned,
      signedPdfUrl: contract.signedPdfUrl,
    };
  }

  async syncStaffingDocumensoEnvelope(
    actor: AuthenticatedUser,
    id: string,
    ip: string,
  ) {
    await this.repository.transaction((session) =>
      this.requireStaffingParty(session, id, actor),
    );
    if (!this.documensoSync?.syncStaffingContractFromDocumenso) {
      throw new ConflictException('Dịch vụ đồng bộ Documenso chưa sẵn sàng');
    }
    return this.documensoSync.syncStaffingContractFromDocumenso(id, ip);
  }

  async downloadStaffingSignedPdf(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const contract = await this.repository.transaction((session) =>
      this.requireStaffingParty(session, id, actor),
    );
    if (!contract.documensoItemId) {
      throw new NotFoundException(
        'Hợp đồng B2B này chưa có tệp PDF trên hệ thống ký số Documenso',
      );
    }
    if (
      contract.status !== 'ACTIVE' ||
      !contract.facilitySignedAt ||
      !contract.adminSignedAt
    ) {
      throw new ConflictException(
        'Hợp đồng B2B chưa hoàn tất đủ 2 chữ ký tuần tự nên chưa thể tải PDF đã đóng dấu.',
      );
    }
    if (!this.documensoClient) {
      throw new ConflictException('Documenso client chưa được cấu hình');
    }
    const buffer = await this.documensoClient.downloadSignedItemPdf(
      contract.documensoItemId,
    );
    return {
      buffer,
      filename: `${contract.contractCode || contract.id}-signed.pdf`,
    };
  }

  async getStaffingTerminationImpact(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<StaffingTerminationImpactDto> {
    return this.repository.transaction(async (session) => {
      const contract = await this.requireStaffingParty(session, id, actor);
      const counts = (await session.getStaffingTerminationImpact?.(
        contract.facilityId,
      )) ?? {
        activeMedicalContracts: 0,
        pendingMedicalContracts: 0,
        openEncounters: 0,
        unsettledSettlements: 0,
        unsettledPaidInvoices: 0,
        activeOrOnboardingDoctors: 0,
        openComplaints: 0,
      };
      return this.buildStaffingImpactDto(contract, counts);
    });
  }

  async requestStaffingTermination(
    actor: AuthenticatedUser,
    id: string,
    dto: RequestStaffingTerminationDto,
    ip: string,
  ): Promise<StaffingContractResponseDto> {
    if (actor.role !== 'HEALTHCARE_FACILITY') {
      throw new ForbiddenException(
        'Chỉ Cơ sở y tế mới có quyền gửi đề nghị chấm dứt hợp đồng B2B đang hiệu lực',
      );
    }

    const reason = dto.reason.trim();
    if (reason.length < 5) {
      throw new BadRequestException(
        'Lý do đề nghị chấm dứt hợp đồng phải có ít nhất 5 ký tự',
      );
    }

    return this.repository.transaction(async (session) => {
      const contract = await this.requireStaffingParty(session, id, actor, {
        lock: true,
      });
      if (contract.status !== 'ACTIVE') {
        throw new ConflictException(
          'Chỉ có thể gửi yêu cầu chấm dứt khi hợp đồng đang ở trạng thái ACTIVE',
        );
      }

      const updated = session.updateStaffingContract
        ? await session.updateStaffingContract(id, {
            terminationRequestStatus: 'PENDING',
            terminationRequestReason: reason,
            terminationRequestedAt: new Date(),
          })
        : contract;

      await session.recordStaffingAudit(
        actor.id,
        'STAFFING_CONTRACT_TERMINATION_REQUESTED',
        id,
        ip,
      );

      const admins = await session.findAdminUsers();
      for (const admin of admins) {
        await session.createNotification({
          userId: admin.id,
          title: 'CSYT đề nghị chấm dứt hợp đồng B2B',
          content: `${contract.facility.facilityName} đã gửi yêu cầu chấm dứt hợp đồng ${contract.contractCode}. Lý do: ${reason}`,
          type: 'STAFFING_CONTRACT_TERMINATION_REQUESTED',
        });
      }

      return this.formatStaffingContract(updated);
    });
  }

  async terminateStaffingContract(
    actor: AuthenticatedUser,
    id: string,
    dto: TerminateStaffingContractDto,
    ip: string,
  ): Promise<StaffingContractResponseDto> {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Chỉ Quản trị viên nền tảng mới có quyền hủy dự thảo hoặc chấm dứt hợp đồng B2B',
      );
    }

    const reason = dto.reason.trim();
    if (reason.length < 5) {
      throw new BadRequestException(
        'Vui lòng nhập lý do hủy / chấm dứt tối thiểu 5 ký tự',
      );
    }

    const result = await this.repository.transaction(async (session) => {
      const contract = await this.requireStaffingParty(session, id, actor, {
        lock: true,
      });

      if (contract.status === 'TERMINATED' || contract.status === 'EXPIRED') {
        throw new ConflictException(
          'Hợp đồng đã chấm dứt hoặc hết hiệu lực trước đó',
        );
      }

      const isPreActivation = [
        'PENDING_FACILITY_SIGNATURE',
        'REVISION_REQUESTED',
        'PENDING_ADMIN_SIGNATURE',
      ].includes(contract.status);

      if (isPreActivation) {
        const updated = session.updateStaffingContract
          ? await session.updateStaffingContract(id, {
              status: 'TERMINATED',
              terminatedByUserId: actor.id,
              terminatedReason: reason,
              terminatedAt: new Date(),
            })
          : await session.updateStaffingContractStatus(id, 'TERMINATED');

        await session.recordStaffingAudit(
          actor.id,
          'STAFFING_CONTRACT_DRAFT_CANCELLED',
          id,
          ip,
        );

        if (contract.facility.userId) {
          await session.createNotification({
            userId: contract.facility.userId,
            title: 'Dự thảo hợp đồng B2B đã bị hủy',
            content: `Quản trị viên đã hủy dự thảo hợp đồng ${contract.contractCode}. Lý do: ${reason}`,
            type: 'STAFFING_CONTRACT_CANCELLED',
          });
        }

        return {
          contract: updated,
          envelopeToCancel: contract.documensoEnvelopeId,
        };
      }

      const counts = (await session.getStaffingTerminationImpact?.(
        contract.facilityId,
      )) ?? {
        activeMedicalContracts: 0,
        pendingMedicalContracts: 0,
        openEncounters: 0,
        unsettledSettlements: 0,
        unsettledPaidInvoices: 0,
        activeOrOnboardingDoctors: 0,
        openComplaints: 0,
      };
      const impact = this.buildStaffingImpactDto(contract, counts);

      if (impact.hasBlockingDependencies && !dto.force) {
        throw new ConflictException({
          message:
            'Cơ sở y tế vẫn còn hợp đồng chăm sóc gia đình đang hoạt động hoặc lịch khám đang mở. Hãy bàn giao/hoàn tất trước hoặc bật xác nhận cưỡng chế kèm ghi chú bàn giao.',
          code: 'STAFFING_TERMINATION_BLOCKED',
          impact,
        });
      }

      if (impact.hasBlockingDependencies && dto.force && !dto.handoverNotes?.trim()) {
        throw new BadRequestException(
          'Khi cưỡng chế chấm dứt hợp đồng đang có hợp đồng 4 bên hoặc lịch khám hoạt động, bắt buộc nhập ghi chú phương án bàn giao (handoverNotes).',
        );
      }

      const fullReason = dto.handoverNotes?.trim()
        ? `${reason} | Phương án bàn giao: ${dto.handoverNotes.trim()}`
        : reason;

      const updated = session.updateStaffingContract
        ? await session.updateStaffingContract(id, {
            status: 'TERMINATED',
            terminatedByUserId: actor.id,
            terminatedReason: fullReason,
            terminatedAt: new Date(),
            ...(contract.terminationRequestStatus === 'PENDING'
              ? { terminationRequestStatus: 'APPROVED' }
              : {}),
          })
        : await session.updateStaffingContractStatus(id, 'TERMINATED');

      await session.recordStaffingAudit(
        actor.id,
        'STAFFING_CONTRACT_TERMINATED',
        id,
        ip,
      );

      if (contract.facility.userId) {
        await session.createNotification({
          userId: contract.facility.userId,
          title: 'Hợp đồng B2B đã chấm dứt hiệu lực',
          content: `Hợp đồng B2B ${contract.contractCode} đã được chấm dứt bởi Quản trị viên. Lý do: ${fullReason}`,
          type: 'STAFFING_CONTRACT_TERMINATED',
        });
      }

      return {
        contract: updated,
        envelopeToCancel: null as string | null,
      };
    });

    await this.safeDeleteDocumensoEnvelope(result.envelopeToCancel);
    return this.formatStaffingContract(result.contract);
  }

  async listStaffingContracts(
    actor: AuthenticatedUser,
    query: ListStaffingContractsDto,
  ): Promise<{ items: StaffingContractResponseDto[]; total: number }> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(50, Math.max(1, query.limit || 10));
    const skip = (page - 1) * limit;

    return this.repository.transaction(async (session) => {
      const where: Prisma.B2bStaffingContractWhereInput = {};

      if (actor.role === 'HEALTHCARE_FACILITY') {
        const facility = await session.findFacilityByUserId(actor.id);
        if (!facility) {
          return { items: [], total: 0 };
        }
        where.facilityId = facility.id;
      } else if (actor.role === 'ADMIN') {
        if (query.facilityId) {
          where.facilityId = query.facilityId;
        }
      } else {
        throw new ForbiddenException(
          'Bạn không có quyền xem hợp đồng nhân lực',
        );
      }

      if (query.status) {
        where.status = query.status;
      }

      const { items, total } = await session.listStaffingContracts(
        where,
        skip,
        limit,
      );

      return {
        items: items.map((item) => this.formatStaffingContract(item)),
        total,
      };
    });
  }

  async getStaffingContract(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<StaffingContractResponseDto> {
    return this.repository.transaction(async (session) => {
      const contract = await session.findStaffingContract(id);
      if (!contract) {
        throw new NotFoundException(
          'Không tìm thấy hợp đồng cung ứng nhân lực',
        );
      }

      if (
        actor.role === 'HEALTHCARE_FACILITY' &&
        contract.facility.userId !== actor.id
      ) {
        throw new ForbiddenException(
          'Bạn không có quyền xem hợp đồng của cơ sở y tế khác',
        );
      } else if (
        actor.role !== 'ADMIN' &&
        actor.role !== 'HEALTHCARE_FACILITY'
      ) {
        throw new ForbiddenException(
          'Bạn không có quyền xem hợp đồng nhân lực',
        );
      }

      return this.formatStaffingContract(contract);
    });
  }

  async listMedicalContracts(
    actor: AuthenticatedUser,
    query: ListMedicalContractsQueryDto,
  ): Promise<{
    items: DetailedMedicalContract[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, query?.page || 1);
    const limit = Math.min(100, Math.max(1, query?.limit || 10));
    const skip = (page - 1) * limit;

    return this.repository.transaction(async (session) => {
      const where: Prisma.MedicalContractWhereInput = {};

      if (query?.status) {
        where.contractStatus = query.status;
      }

      if (actor.role === 'FAMILY_REP') {
        let familyId = actor.familyUnitId;
        if (!familyId) {
          const family = await session.findFamilyByRepresentativeUserId(
            actor.id,
          );
          familyId = family?.id ?? null;
        }
        if (!familyId) {
          return { items: [], total: 0, page, limit };
        }
        where.familyId = familyId;
      } else if (actor.role === 'HEALTHCARE_FACILITY') {
        const facility = await session.findFacilityByUserId(actor.id);
        if (!facility) {
          return { items: [], total: 0, page, limit };
        }
        where.facilityId = facility.id;
      } else if (actor.role === 'DOCTOR') {
        const doctor = await session.findDoctorByUserId(actor.id);
        if (!doctor) {
          return { items: [], total: 0, page, limit };
        }
        where.doctorId = doctor.id;
      } else if (actor.role === 'ADMIN') {
        if (query?.facilityId) {
          where.facilityId = query.facilityId;
        }
      } else {
        throw new ForbiddenException(
          'Không có quyền xem danh sách hợp đồng y tế',
        );
      }

      const { items, total } = await session.listMedicalContracts(
        where,
        skip,
        limit,
      );

      return {
        items,
        total,
        page,
        limit,
      };
    });
  }

  async findMedicalContractById(
    actor: AuthenticatedUser,
    id: string,
    options?: FindMedicalContractOptions,
    ip?: string,
  ): Promise<DetailedMedicalContract> {
    const contract = await this.repository.transaction(async (session) => {
      const found = await session.findMedicalContractById(id);
      if (!found) {
        throw new NotFoundException('Không tìm thấy hợp đồng y tế');
      }

      if (actor.role === 'ADMIN') {
        return found;
      }

      let isAllowed = false;
      if (
        actor.role === 'FAMILY_REP' &&
        (found.familyUnit?.representativeUserId === actor.id ||
          found.familyId === actor.familyUnitId)
      ) {
        isAllowed = true;
      } else if (
        actor.role === 'HEALTHCARE_FACILITY' &&
        (found.facility?.userId === actor.id ||
          found.facilityId === actor.id)
      ) {
        isAllowed = true;
      } else if (
        actor.role === 'DOCTOR' &&
        found.doctor &&
        (found.doctor.userId === actor.id || found.doctorId === actor.id)
      ) {
        isAllowed = true;
      }

      if (!isAllowed) {
        throw new ForbiddenException(
          'Bạn không có quyền truy cập thông tin hợp đồng này',
        );
      }

      return found;
    });

    // Đồng bộ Documenso **ngoài** transaction đọc để không giữ transaction
    // serializable trong lúc chờ HTTP tới máy chủ ký điện tử.
    const needsSync =
      contract.contractStatus === 'PENDING_APPROVAL' &&
      Boolean(contract.documensoEnvelopeId) &&
      Boolean(this.documensoSync);

    if (!needsSync) {
      return contract;
    }

    const syncResult = await this.documensoSync!.syncContractIfNeeded(id, {
      force: Boolean(options?.forceSync),
      ipAddress: ip,
    });

    if (!syncResult) {
      return contract;
    }

    const refreshed = await this.repository.transaction((session) =>
      session.findMedicalContractById(id),
    );

    return refreshed ?? contract;
  }

  async getCareNeedsSummary(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<CareNeedsSummaryDto> {
    return this.repository.transaction(async (session) => {
      const contract = await session.findMedicalContractById(id);
      if (!contract) {
        throw new NotFoundException('Không tìm thấy hợp đồng y tế');
      }

      if (actor.role === 'ADMIN') {
        // Admin allowed
      } else if (actor.role === 'DOCTOR') {
        if (
          !contract.doctor ||
          (contract.doctor.userId !== actor.id && contract.doctorId !== actor.id)
        ) {
          throw new ForbiddenException(
            'Bác sĩ không được phân công cho hợp đồng này',
          );
        }
      } else if (actor.role === 'HEALTHCARE_FACILITY') {
        if (
          contract.facility?.userId !== actor.id &&
          contract.facilityId !== actor.id
        ) {
          throw new ForbiddenException(
            'Bạn không có quyền truy cập thông tin chăm sóc của hợp đồng này',
          );
        }
      } else if (actor.role === 'FAMILY_REP') {
        if (
          contract.familyUnit?.representativeUserId !== actor.id &&
          contract.familyId !== actor.familyUnitId
        ) {
          throw new ForbiddenException(
            'Bạn không có quyền truy cập thông tin chăm sóc của hợp đồng này',
          );
        }
      } else {
        throw new ForbiddenException(
          'Bạn không có quyền truy cập thông tin chăm sóc của hợp đồng này',
        );
      }

      const patientIds = (contract.members || [])
        .map((m: any) => m.patientId || m.patient?.id)
        .filter(Boolean);

      let patients: any[] = [];
      if (session.findPatientsWithClinicalProfile && patientIds.length > 0) {
        patients = await session.findPatientsWithClinicalProfile(patientIds);
      }

      const patientProfileMap = new Map<string, any>(
        patients.map((p) => [p.id, p]),
      );

      const today = new Date();
      const members: PatientCareSummaryDto[] = (contract.members || []).map(
        (m: any) => {
          const rawPatient =
            patientProfileMap.get(m.patientId || m.patient?.id) ||
            m.patient ||
            {};
          const dob = rawPatient.dateOfBirth
            ? new Date(rawPatient.dateOfBirth)
            : new Date();

          let age = today.getFullYear() - dob.getFullYear();
          const monthDiff = today.getMonth() - dob.getMonth();
          if (
            monthDiff < 0 ||
            (monthDiff === 0 && today.getDate() < dob.getDate())
          ) {
            age--;
          }
          if (age < 0) age = 0;

          let ageGroup: 'CHILD' | 'ADOLESCENT' | 'ADULT' | 'ELDERLY';
          if (age < 13) {
            ageGroup = 'CHILD';
          } else if (age < 18) {
            ageGroup = 'ADOLESCENT';
          } else if (age < 60) {
            ageGroup = 'ADULT';
          } else {
            ageGroup = 'ELDERLY';
          }

          const allergies = (rawPatient.allergies || []).map((a: any) => ({
            id: a.id,
            allergenType: a.allergenType,
            allergenName: a.allergenName,
            severity: a.severity,
            clinicalManifestation: a.clinicalManifestation,
          }));

          const documents = (rawPatient.documents || []).map((d: any) => ({
            id: d.id,
            documentName: d.documentName,
            documentType: d.documentType,
            fileUrl: d.fileUrl,
            fileSizeKb: d.fileSizeKb,
            recordedDate: d.recordedDate,
          }));

          return {
            patientId: rawPatient.id || m.patientId,
            fullName: rawPatient.fullName || 'Thành viên',
            dateOfBirth: dob,
            age,
            ageGroup,
            gender: rawPatient.gender || 'OTHER',
            relationshipToHead: rawPatient.relationshipToHead || 'MEMBER',
            citizenId: rawPatient.citizenId,
            healthInsuranceNumber: rawPatient.healthInsuranceNumber,
            allergies,
            documents,
          };
        },
      );

      return {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        familyId: contract.familyId,
        packageName:
          contract.servicePackage?.packageName ||
          (contract.billingSnapshot as any)?.packageName ||
          'Gói Chăm Sóc Sức Khỏe Gia Đình',
        totalMembers: members.length,
        members,
      };
    });
  }

  async getContractDocument(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<any> {
    return this.repository.transaction(async (session) => {
      const contract = await session.findMedicalContractById(id);
      if (!contract) {
        throw new NotFoundException('Không tìm thấy hợp đồng y tế');
      }

      if (actor.role === 'ADMIN') {
        // Admin allowed
      } else if (
        actor.role === 'FAMILY_REP' &&
        (contract.familyUnit?.representativeUserId === actor.id ||
          contract.familyId === actor.familyUnitId)
      ) {
        // Family allowed
      } else if (
        actor.role === 'HEALTHCARE_FACILITY' &&
        (contract.facility?.userId === actor.id ||
          contract.facilityId === actor.id)
      ) {
        // Facility allowed
      } else if (
        actor.role === 'DOCTOR' &&
        contract.doctor &&
        (contract.doctor.userId === actor.id || contract.doctorId === actor.id)
      ) {
        // Assigned doctor allowed
      } else {
        throw new ForbiddenException(
          'Bạn không có quyền truy cập văn bản hợp đồng này',
        );
      }

      let signatures = contract.signatures;
      if (!signatures || signatures.length === 0) {
        signatures = await session.findContractSignatures(contract.id);
      }

      const termsHash =
        signatures?.[0]?.termsHash || calculateContractTermsHash(contract);

      const renderedHtml = this.documentRenderer.renderHtml(
        { ...contract, termsHash },
        signatures,
      );
      const renderedSignatures = this.documentRenderer.renderSignatures(
        signatures,
      );

      return {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        status: contract.contractStatus,
        termsHash,
        renderedHtml,
        signatures: renderedSignatures,
        parties: {
          family: {
            familyId: contract.familyId,
            familyName:
              (contract.familyUnit as any)?.familyName ||
              (contract.familyUnit as any)?.familyCode ||
              contract.familyUnit?.homeAddress,
            representativeUserId: contract.familyUnit?.representativeUserId,
          },
          facility: {
            facilityId: contract.facilityId,
            facilityName: contract.facility?.facilityName,
          },
          doctor: contract.doctor
            ? {
                doctorId: contract.doctor.id,
                doctorName: contract.doctor.doctorName,
                specialty: contract.doctor.specialty,
              }
            : null,
          platform: {
            name: 'Công ty Cổ phần Công nghệ Y tế FamiDoc',
            role: 'Platform Provider',
          },
        },
        members: (contract.members || []).map((m: any) => ({
          memberId: m.id,
          patientId: m.patientId,
          fullName: m.patient?.fullName,
          dateOfBirth: m.patient?.dateOfBirth,
          gender: m.patient?.gender,
          relationshipToHead: m.patient?.relationshipToHead,
        })),
      };
    });
  }

  private formatStaffingContract(contract: any): StaffingContractResponseDto {
    const facilitySigned =
      Boolean(contract.facilitySignedAt) ||
      contract.status === 'PENDING_ADMIN_SIGNATURE' ||
      contract.status === 'ACTIVE';
    const adminSigned =
      Boolean(contract.adminSignedAt) || contract.status === 'ACTIVE';

    return {
      id: contract.id,
      contractCode: contract.contractCode,
      facilityId: contract.facilityId,
      platformCommissionRate: Number(contract.platformCommissionRate),
      facilityRevenueRate: Number(contract.facilityRevenueRate),
      startDate: contract.startDate,
      endDate: contract.endDate,
      signedPdfUrl: contract.signedPdfUrl ?? null,
      contractTerms: contract.contractTerms ?? null,
      revisionReason: contract.revisionReason ?? null,
      documensoEnvelopeId: contract.documensoEnvelopeId ?? null,
      documensoItemId: contract.documensoItemId ?? null,
      facilitySignedAt: contract.facilitySignedAt ?? null,
      adminSignedAt: contract.adminSignedAt ?? null,
      facilitySigned,
      adminSigned,
      terminationRequestStatus: contract.terminationRequestStatus ?? null,
      terminationRequestReason: contract.terminationRequestReason ?? null,
      terminationRequestedAt: contract.terminationRequestedAt ?? null,
      terminatedReason: contract.terminatedReason ?? null,
      terminatedAt: contract.terminatedAt ?? null,
      status: contract.status,
      createdAt: contract.createdAt,
      updatedAt: contract.updatedAt,
      platformLegal: resolvePlatformLegalIdentity(),
      ...(contract.facility
        ? {
            facility: {
              id: contract.facility.id,
              facilityName: contract.facility.facilityName,
              licenseNumber: contract.facility.licenseNumber,
              licenseIssuer: contract.facility.licenseIssuer ?? null,
              licenseDate: contract.facility.licenseDate ?? null,
              taxCode: contract.facility.taxCode ?? null,
              address: contract.facility.address,
              hotline: contract.facility.hotline,
            },
          }
        : {}),
    };
  }

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
        if (dto.additionalMembers !== undefined)
          throw new BadRequestException('Quota expansion cannot add members');
        amount = calculateHomeVisitAddendum(terms, dto.extraHomeVisits!);
      } else {
        if (dto.extraHomeVisits !== undefined)
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
  async createPackageUpgradeContract(
    actor: AuthenticatedUser,
    id: string,
    dto: CreatePackageUpgradeDto,
  ): Promise<ContractSummary> {
    const today = todayInVietnam();
    const shouldProvisionDocumenso = this.isDocumensoConfigured();

    const firstPass = await this.repository.transaction(async (session) => {
      const old = await this.requirePartyContract(session, id, actor);
      if (!['FAMILY_REP', 'ADMIN'].includes(actor.role))
        throw new ForbiddenException(
          'Only the family or Admin can request a replacement contract',
        );
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
        const { benefits } = readFrozenContractTerms(existing.billingSnapshot);
        const agreedVideoVisits =
          benefits.videoQuotaPolicy === 'CONTRACT'
            ? benefits.quotas.videoConsultations
            : undefined;
        // Gọi lại cùng dữ liệu thì trả hợp đồng cũ. Đổi hạn mức phải lập điều khoản mới.
        if (agreedVideoVisits !== dto.videoConsultations)
          throw new ConflictException(
            'A replacement contract with different video terms is already pending',
          );
        return {
          kind: 'DONE' as const,
          summary: {
            ...this.toContractSummary(existing),
            documensoEnvelopeId:
              (existing as { documensoEnvelopeId?: string | null })
                .documensoEnvelopeId ?? null,
            documensoItemId:
              (existing as { documensoItemId?: string | null })
                .documensoItemId ?? null,
          },
        };
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
      const videoAgreedInContract = pkg.videoQuotaPolicy === 'CONTRACT';
      if (videoAgreedInContract && dto.videoConsultations === undefined)
        throw new BadRequestException(
          'Cần nhập số lượt video đã thỏa thuận cho gói này.',
        );
      if (!videoAgreedInContract && dto.videoConsultations !== undefined)
        throw new BadRequestException('Gói này có số lượt video cố định.');
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
          videoQuotaPolicy: videoAgreedInContract ? 'CONTRACT' : undefined,
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
        videoAgreedInContract
          ? { videoConsultations: dto.videoConsultations }
          : undefined,
      );
      const snapshot = {
        package: quote.package,
        members: quote.members,
        pricing: quote.pricing,
        benefits: quote.benefits,
      };
      const contractNumber =
        'MC' + randomUUID().replaceAll('-', '').toUpperCase();

      if (!old.isDemo && shouldProvisionDocumenso) {
        const parties = await this.loadContractParties(session, old);
        const contractInput: BuildDocumensoContractHtmlInput = {
          contractNumber,
          durationMonths: pkg.durationMonths,
          pkg,
          pricing: {
            basePriceVnd: quote.pricing.basePriceVnd,
            additionalMemberTotalVnd: quote.pricing.additionalMembersTotalVnd,
            additionalMemberUnitPriceVnd: moneyToNumber(
              pkg.additionalMemberMonthlyPrice,
            ),
            totalPriceVnd: quote.pricing.totalPriceVnd,
          },
          memberCount,
          family: parties.family,
          facility: parties.facility,
          doctor: parties.doctor,
          admin: parties.admin,
        };
        this.assertRealPartyDataIfStrict(contractInput);
        const recipients = this.buildDocumensoRecipients({
          ...parties,
          familyId: old.familyId,
          facilityId: old.facilityId,
        });
        return {
          kind: 'PROVISION' as const,
          old,
          pkg,
          quote,
          snapshot,
          memberCount,
          contractNumber,
          contractInput,
          recipients,
        };
      }

      if (old.contractStatus === 'ACTIVE') {
        await session.updateContractStatus(old.id, 'EXPIRED');
        if (old.doctorId) await session.refreshDoctorPanel(old.doctorId);
      }
      // Hợp đồng mới bắt đầu kỳ mới. Không cộng tiền, ngày hay lượt chưa dùng của hợp đồng cũ.
      const item = await session.createUpgrade({
        contractNumber,
        familyId: old.familyId,
        facilityId: old.facilityId,
        doctorId: old.doctorId,
        packageId: pkg.id,
        totalAmount: quote.pricing.totalPriceVnd,
        remainingHomeVisits: pkg.periodicVisitsQuota,
        remainingTelehealth: quote.benefits.quotas.videoConsultations,
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
      return { kind: 'DONE' as const, summary: this.toContractSummary(item) };
    });

    if (firstPass.kind === 'DONE') {
      return firstPass.summary;
    }

    const documensoEnvelope = await this.provisionDocumensoEnvelope(
      firstPass.contractNumber,
      firstPass.contractInput,
      firstPass.recipients,
    );

    try {
      return await this.repository.transaction(async (session) => {
        const old = await this.requirePartyContract(session, id, actor);
        if (
          !['EXPIRED', 'TERMINATED'].includes(old.contractStatus) &&
          old.endDate > today
        ) {
          throw new ConflictException(
            'The old contract must expire or complete approved early termination first',
          );
        }
        if (!['ACTIVE', 'EXPIRED', 'TERMINATED'].includes(old.contractStatus)) {
          throw new ConflictException(
            'An unsigned/unpaid contract cannot be used for renewal or upgrade',
          );
        }
        if (old.isDemo) {
          throw new ConflictException(
            'Cannot attach Documenso envelope to demo contract',
          );
        }
        const existing = await session.findOpenUpgrade(id);
        if (existing) {
          throw new ConflictException(
            'A different replacement contract is already pending',
          );
        }
        if (await session.hasOtherActiveContract(old.familyId, old.id)) {
          throw new ConflictException(
            'The family already has another active contract',
          );
        }
        const pkg = await session.findPackage(dto.packageId);
        if (!pkg || pkg.status !== 'ACTIVE' || pkg.deletedAt) {
          throw new NotFoundException('Active package not found');
        }
        const memberCount = await session.countFamilyMembers(old.familyId);
        if (memberCount < 1) {
          throw new BadRequestException(
            'The family has no active member profiles',
          );
        }
        if (memberCount !== firstPass.memberCount) {
          throw new ConflictException(
            'Family member count changed while creating replacement contract',
          );
        }
        if (old.contractStatus === 'ACTIVE') {
          await session.updateContractStatus(old.id, 'EXPIRED');
          if (old.doctorId) await session.refreshDoctorPanel(old.doctorId);
        }

        const item = await session.createUpgrade({
          contractNumber: firstPass.contractNumber,
          familyId: old.familyId,
          facilityId: old.facilityId,
          doctorId: old.doctorId,
          packageId: firstPass.pkg.id,
          totalAmount: firstPass.quote.pricing.totalPriceVnd,
          remainingHomeVisits: firstPass.pkg.periodicVisitsQuota,
          remainingTelehealth:
            firstPass.quote.benefits.quotas.videoConsultations,
          startDate: today,
          endDate: addContractMonths(today, firstPass.pkg.durationMonths),
          contractStatus: 'PENDING_APPROVAL',
          billingSnapshot:
            firstPass.snapshot as unknown as Prisma.InputJsonValue,
          memberCount: firstPass.memberCount,
          isDemo: old.isDemo,
          upgradedFromId: old.id,
          documensoEnvelopeId: documensoEnvelope.envelopeId,
          documensoItemId: documensoEnvelope.envelopeItemId,
        });

        await this.saveDocumensoSignersForContract(
          session,
          item.id,
          documensoEnvelope.signers,
        );

        await session.recordChange(
          actor.id,
          item,
          'CREATE_PACKAGE_UPGRADE_CONTRACT',
          item.id,
        );

        const familySigner = documensoEnvelope.signers.find(
          (s) => s.role === 'FAMILY_REP',
        );

        return {
          ...this.toContractSummary(item),
          documensoEnvelopeId: documensoEnvelope.envelopeId,
          documensoItemId: documensoEnvelope.envelopeItemId,
          signingToken: familySigner?.token ?? null,
          signingUrl: familySigner?.signingUrl ?? null,
        };
      });
    } catch (error) {
      await this.deleteEnvelopeSafely(documensoEnvelope.envelopeId);
      throw error;
    }
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
      if (!contract.doctor || !contract.doctorId) {
        throw new BadRequestException('Hợp đồng chưa có bác sĩ phân công');
      }
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
  // Chỉ bản nháp chưa thanh toán mới được hủy/thay thế; hóa đơn PAID khóa vĩnh viễn.
  private async requireReplaceableDraft(
    session: ContractsSession,
    contractId: string,
    familyId: string,
  ): Promise<ChangeContract> {
    const contract = await session.findContractForUpdate(contractId);
    if (!contract)
      throw new NotFoundException('Không tìm thấy hợp đồng cần hủy bản nháp');
    if (contract.familyId !== familyId) {
      throw new ForbiddenException(
        'Hợp đồng cần hủy không thuộc hộ gia đình hiện tại',
      );
    }
    if (
      !['PENDING_APPROVAL', 'PENDING_PAYMENT'].includes(contract.contractStatus)
    ) {
      throw new ConflictException(
        'Chỉ có thể hủy hợp đồng đang ở trạng thái PENDING_APPROVAL hoặc PENDING_PAYMENT',
      );
    }
    if (await session.hasPaidInvoice(contractId)) {
      throw new ConflictException(
        'Hợp đồng đã có giao dịch thanh toán PAID, không thể hủy bản nháp',
      );
    }
    return contract;
  }
  private async terminateUnpaidDraft(
    session: ContractsSession,
    contract: ChangeContract,
    reason: string,
    actorId: string,
    action: string,
  ) {
    await session.updateContractStatus(contract.id, 'TERMINATED', reason);
    await session.cancelPendingInvoices(contract.id);
    await session.recordChange(actorId, contract, action, contract.id);
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
    if (role === 'FAMILY_REP') {
      return;
    }
    if (!signed.includes('FAMILY_REP')) {
      throw new ConflictException(
        'Đại diện hộ gia đình (Bên A) phải ký hợp đồng trước khi các bên còn lại ký',
      );
    }
  }

  private isDocumensoConfigured(): boolean {
    if (!this.documensoClient) return false;
    return typeof this.documensoClient.isConfigured === 'function'
      ? this.documensoClient.isConfigured()
      : true;
  }

  private assertRealPartyDataIfStrict(
    contractInput: BuildDocumensoContractHtmlInput,
  ) {
    // Guard chặn dữ liệu thử nghiệm (DEMO / .invalid) ở thông tin 4 bên:
    // khi bật chế độ nghiêm ngặt thì từ chối khởi tạo TRƯỚC khi render PDF
    // và gọi Documenso để không phát hành hợp đồng pháp lý chứa dữ liệu mẫu.
    if (!isStrictRealPartyMode()) return;
    const validation = validateRealPartyContractData(
      buildDocumensoContractFieldValues(contractInput),
    );
    if (!validation.valid) {
      throw new BadRequestException(
        `Thông tin các bên hợp đồng chứa dữ liệu thử nghiệm chưa hợp lệ: ${validation.issues.join('; ')}`,
      );
    }
  }

  private async loadContractParties(
    session: ContractsSession,
    contract: ChangeContract,
  ) {
    const family =
      (contract.familyUnit as { representativeUser?: unknown })
        ?.representativeUser
        ? contract.familyUnit
        : (await session.findFamilyById?.(contract.familyId)) ??
          contract.familyUnit;
    const facility =
      (contract.facility as { user?: unknown })?.user
        ? contract.facility
        : (await session.findFacilityById?.(contract.facilityId)) ??
          contract.facility;
    const doctor = !contract.doctorId
      ? null
      : (await session.findDoctorById?.(contract.doctorId)) ??
        contract.doctor ??
        null;
    const admin = (await session.findFirstActiveAdminUser?.()) ?? null;
    return { family, facility, doctor, admin };
  }

  private buildDocumensoRecipients(params: {
    family: any;
    facility: any;
    doctor: any;
    admin: { id?: string; email?: string | null; fullName?: string | null } | null;
    familyId: string;
    facilityId: string;
  }): DocumensoRecipientInput[] {
    const { family, facility, doctor, admin, familyId, facilityId } = params;
    const facMeta = facility as {
      email?: string;
      representativeName?: string;
      user?: { email?: string; fullName?: string };
    };
    return [
      {
        role: 'FAMILY_REP',
        email:
          family?.representativeUser?.email ||
          `family-${familyId.slice(0, 8)}@famidoc.local`,
        name:
          family?.representativeUser?.fullName || 'Đại diện Hộ gia đình',
        externalId: family?.representativeUserId,
      },
      {
        role: 'HEALTHCARE_FACILITY',
        email:
          facMeta?.email ||
          facMeta?.user?.email ||
          `facility-${facilityId.slice(0, 8)}@famidoc.local`,
        name:
          facMeta?.representativeName ||
          facMeta?.user?.fullName ||
          facility?.facilityName ||
          'Cơ sở Y tế phối hợp',
        externalId: facility?.userId,
      },
      {
        role: 'ASSIGNED_DOCTOR',
        email:
          doctor?.user?.email ||
          `doctor-${(doctor?.id || facilityId).slice(0, 8)}@famidoc.local`,
        name:
          doctor?.doctorName ||
          doctor?.user?.fullName ||
          'Bác sĩ Gia đình phụ trách',
        externalId: doctor?.userId,
      },
      {
        role: 'ADMIN',
        email: admin?.email || 'admin@famidoc.online',
        name: admin?.fullName || 'Ban Quản trị FamiDoc',
        externalId: admin?.id,
      },
    ];
  }

  private buildContractInputFromContract(
    contract: ChangeContract,
    parties: { family: any; facility: any; doctor: any; admin: any },
  ): BuildDocumensoContractHtmlInput {
    const pkg = contract.servicePackage;
    const snapshot = (contract.billingSnapshot ?? {}) as {
      pricing?: {
        basePriceVnd?: number;
        additionalMembersTotalVnd?: number;
        additionalMemberTotalVnd?: number;
        totalPriceVnd?: number;
      };
    };
    const totalPriceVnd =
      snapshot.pricing?.totalPriceVnd ?? moneyToNumber(contract.totalAmount);
    const basePriceVnd =
      snapshot.pricing?.basePriceVnd ?? moneyToNumber(pkg.basePrice);
    const additionalMemberTotalVnd =
      snapshot.pricing?.additionalMembersTotalVnd ??
      snapshot.pricing?.additionalMemberTotalVnd ??
      Math.max(0, totalPriceVnd - basePriceVnd);

    return {
      contractNumber: contract.contractNumber,
      durationMonths: pkg.durationMonths,
      pkg,
      pricing: {
        basePriceVnd,
        additionalMemberTotalVnd,
        additionalMemberUnitPriceVnd: moneyToNumber(
          pkg.additionalMemberMonthlyPrice,
        ),
        totalPriceVnd,
      },
      memberCount: contract.memberCount,
      family: parties.family,
      facility: parties.facility,
      doctor: parties.doctor,
      admin: parties.admin,
      additionalTerms:
        (contract as { additionalTerms?: string | null }).additionalTerms ??
        null,
    };
  }

  private async provisionDocumensoEnvelope(
    contractNumber: string,
    contractInput: BuildDocumensoContractHtmlInput,
    recipients: DocumensoRecipientInput[],
  ): Promise<DocumensoEnvelopeCreatedResult> {
    const contractHtml = buildDocumensoContractHtml(contractInput);
    const pdfRenderer = this.pdfRenderer || new ContractPdfRendererService();
    const pdfBuffer = await pdfRenderer.renderPdf(contractHtml);
    return this.documensoClient!.createFourPartyEnvelope({
      contractId: contractNumber,
      contractNumber,
      pdfBuffer,
      recipients,
    });
  }

  private async saveDocumensoSignersForContract(
    session: ContractsSession,
    contractId: string,
    signers: DocumensoEnvelopeCreatedResult['signers'],
  ) {
    if (!session.saveDocumensoSigners || !signers.length) return;
    await session.saveDocumensoSigners(
      signers.map((signer) => ({
        contractId,
        signerRole: signer.role,
        documensoRecipientId: signer.recipientId,
        documensoToken: signer.token,
        documensoSigningUrl: signer.signingUrl,
        status: 'PENDING',
      })),
    );
  }

  private buildSigningSessionResponse(params: {
    contract: ChangeContract;
    role: SignerRole;
    signedRoles: SignerRole[];
    canSign: boolean;
    signingToken: string | null;
    signingUrl: string | null;
  }) {
    const { contract, role, signedRoles, canSign, signingToken, signingUrl } =
      params;
    const alreadySigned = signedRoles.includes(role);
    const itemId = (contract as { documensoItemId?: string | null })
      .documensoItemId;

    return {
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      contractStatus: contract.contractStatus,
      signerRole: role,
      alreadySigned,
      canSign,
      signingToken,
      signingUrl,
      signedRoles,
      signedPdfUrl: resolveSignedPdfUrl(contract.id, {
        documensoItemId: itemId,
        contractStatus: contract.contractStatus,
        signedRoles,
      }),
    };
  }

  async getSigningSession(actor: AuthenticatedUser, id: string) {
    const initial = await this.repository.transaction(async (session) => {
      const contract = await this.requirePartyContract(session, id, actor);
      const role = getContractSignerRole(contract, actor);
      const signatures = await session.findContractSignatures(id);
      const signedRoles = signatures.map((s) => s.signerRole);
      const signers = (await session.findDocumensoSigners?.(id)) ?? [];

      const envelopeId =
        (contract as { documensoEnvelopeId?: string | null })
          .documensoEnvelopeId ?? null;
      const alreadySigned = signedRoles.includes(role);
      const familySigned = signedRoles.includes('FAMILY_REP');
      const existingSigner = signers.find((s) => s.signerRole === role);

      const needsLazyProvision =
        !contract.isDemo &&
        contract.contractStatus === 'PENDING_APPROVAL' &&
        !envelopeId &&
        this.isDocumensoConfigured();

      if (needsLazyProvision) {
        const parties = await this.loadContractParties(session, contract);
        const contractInput = this.buildContractInputFromContract(
          contract,
          parties,
        );
        this.assertRealPartyDataIfStrict(contractInput);
        const recipients = this.buildDocumensoRecipients({
          ...parties,
          familyId: contract.familyId,
          facilityId: contract.facilityId,
        });
        return {
          mode: 'LAZY_PROVISION' as const,
          contract,
          role,
          signedRoles,
          signers,
          contractInput,
          recipients,
        };
      }

      const needsBackfill =
        !contract.isDemo &&
        contract.contractStatus === 'PENDING_APPROVAL' &&
        !alreadySigned &&
        !(role !== 'FAMILY_REP' && !familySigned) &&
        Boolean(envelopeId) &&
        !existingSigner &&
        this.isDocumensoConfigured() &&
        typeof this.documensoClient?.getEnvelope === 'function';

      if (needsBackfill) {
        const parties = await this.loadContractParties(session, contract);
        const recipients = this.buildDocumensoRecipients({
          ...parties,
          familyId: contract.familyId,
          facilityId: contract.facilityId,
        });
        return {
          mode: 'BACKFILL' as const,
          contract,
          role,
          signedRoles,
          signers,
          envelopeId: envelopeId!,
          recipients,
        };
      }

      return {
        mode: 'DIRECT' as const,
        contract,
        role,
        signedRoles,
        signers,
      };
    });

    let resolved: {
      contract: ChangeContract;
      signedRoles: SignerRole[];
      signers: ContractDocumensoSigner[];
    };

    if (initial.mode === 'LAZY_PROVISION') {
      const documensoEnvelope = await this.provisionDocumensoEnvelope(
        initial.contract.contractNumber,
        initial.contractInput,
        initial.recipients,
      );

      let wonRace = false;
      try {
        resolved = await this.repository.transaction(async (session) => {
          const locked = await this.requirePartyContract(session, id, actor);
          const lockedEnvelopeId = (
            locked as { documensoEnvelopeId?: string | null }
          ).documensoEnvelopeId;
          if (
            !lockedEnvelopeId &&
            locked.contractStatus === 'PENDING_APPROVAL' &&
            !locked.isDemo
          ) {
            const updated = await session.updateContractDocumensoEnvelope?.(
              id,
              documensoEnvelope.envelopeId,
              documensoEnvelope.envelopeItemId,
            );
            if (updated === true) {
              wonRace = true;
              await this.saveDocumensoSignersForContract(
                session,
                id,
                documensoEnvelope.signers,
              );
              await session.clearLegacyNonDocumensoSignatures?.(id);
            }
          }

          const refreshedContract = wonRace
            ? ({
                ...locked,
                documensoEnvelopeId: documensoEnvelope.envelopeId,
                documensoItemId: documensoEnvelope.envelopeItemId,
              } as ChangeContract)
            : locked;
          const signatures = await session.findContractSignatures(id);
          const signers = (await session.findDocumensoSigners?.(id)) ?? [];
          return {
            contract: refreshedContract,
            signedRoles: signatures.map((s) => s.signerRole),
            signers,
          };
        });
      } catch (error) {
        await this.deleteEnvelopeSafely(documensoEnvelope.envelopeId);
        throw error;
      }

      if (!wonRace) {
        await this.deleteEnvelopeSafely(documensoEnvelope.envelopeId);
      }
    } else if (initial.mode === 'BACKFILL') {
      const remoteEnvelope = await this.documensoClient!.getEnvelope(
        initial.envelopeId,
      );

      const rolesByEmail = new Map<string, SignerRole[]>();
      for (const recipient of initial.recipients) {
        const normalized = recipient.email.trim().toLowerCase();
        if (!normalized) continue;
        const list = rolesByEmail.get(normalized) ?? [];
        list.push(recipient.role);
        rolesByEmail.set(normalized, list);
      }

      const existingRoles = new Set(initial.signers.map((s) => s.signerRole));
      const baseUrl =
        typeof this.documensoClient!.getBaseUrl === 'function'
          ? this.documensoClient!.getBaseUrl()
          : (
              process.env.DOCUMENSO_API_URL?.trim() ||
              'https://sign.famidoc.online'
            ).replace(/\/+$/, '');

      const matchedRows: Array<{
        contractId: string;
        signerRole: SignerRole;
        documensoRecipientId: number;
        documensoToken: string;
        documensoSigningUrl: string;
        status: string;
        completedAt?: Date | null;
      }> = [];

      for (const remoteRec of remoteEnvelope.recipients ?? []) {
        const emailKey = (remoteRec.email ?? '').trim().toLowerCase();
        if (!emailKey) continue;
        const roles = rolesByEmail.get(emailKey);
        if (!roles || roles.length !== 1) continue;
        const matchedRole = roles[0];
        if (existingRoles.has(matchedRole)) continue;
        const token = remoteRec.token?.trim();
        if (!token) continue;
        const rawTimestamp = remoteRec.signedAt || remoteRec.completedAt;
        let completedAt: Date | null = null;
        if (rawTimestamp) {
          const parsed = new Date(rawTimestamp);
          if (!Number.isNaN(parsed.getTime())) {
            completedAt = parsed;
          }
        }
        matchedRows.push({
          contractId: initial.contract.id,
          signerRole: matchedRole,
          documensoRecipientId: remoteRec.id,
          documensoToken: token,
          documensoSigningUrl:
            remoteRec.signingUrl || `${baseUrl}/sign/${token}`,
          status: remoteRec.signingStatus || 'PENDING',
          completedAt,
        });
      }

      const matchedCaller = matchedRows.some(
        (row) => row.signerRole === initial.role,
      );
      if (!matchedCaller) {
        throw new NotFoundException(
          'Hợp đồng này chưa có phiên ký Documenso cho vai trò hiện tại',
        );
      }

      resolved = await this.repository.transaction(async (session) => {
        const locked = await this.requirePartyContract(session, id, actor);
        if (locked.contractStatus === 'PENDING_APPROVAL' && !locked.isDemo) {
          await session.saveDocumensoSigners?.(matchedRows);
        }
        const signatures = await session.findContractSignatures(id);
        const signers = (await session.findDocumensoSigners?.(id)) ?? [];
        return {
          contract: locked,
          signedRoles: signatures.map((s) => s.signerRole),
          signers,
        };
      });
    } else {
      resolved = {
        contract: initial.contract,
        signedRoles: initial.signedRoles,
        signers: initial.signers,
      };
    }

    const { contract, signedRoles, signers } = resolved;
    const alreadySigned = signedRoles.includes(initial.role);
    const familySigned = signedRoles.includes('FAMILY_REP');

    if (
      contract.isDemo ||
      alreadySigned ||
      contract.contractStatus !== 'PENDING_APPROVAL'
    ) {
      return this.buildSigningSessionResponse({
        contract,
        role: initial.role,
        signedRoles,
        canSign: false,
        signingToken: null,
        signingUrl: null,
      });
    }

    if (initial.role !== 'FAMILY_REP' && !familySigned) {
      throw new ConflictException(
        'Hợp đồng đang chờ Đại diện hộ gia đình (Bên A) ký xác nhận trên Documenso trước khi các bên còn lại ký.',
      );
    }

    const signer = signers.find((s) => s.signerRole === initial.role);
    if (!signer) {
      throw new NotFoundException(
        'Hợp đồng này chưa có phiên ký Documenso cho vai trò hiện tại',
      );
    }

    return this.buildSigningSessionResponse({
      contract,
      role: initial.role,
      signedRoles,
      canSign: true,
      signingToken: signer.documensoToken,
      signingUrl: signer.documensoSigningUrl,
    });
  }

  async syncDocumensoEnvelope(
    actor: AuthenticatedUser,
    id: string,
    ip: string,
  ) {
    await this.repository.transaction((session) =>
      this.requirePartyContract(session, id, actor),
    );
    if (!this.documensoSync) {
      throw new ConflictException('Dịch vụ đồng bộ Documenso chưa sẵn sàng');
    }
    return this.documensoSync.syncContractFromDocumenso(id, ip);
  }

  async downloadSignedPdf(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const { contract, signedRoles } = await this.repository.transaction(
      async (session) => {
        const contract = await this.requirePartyContract(session, id, actor);
        const signatures = await session.findContractSignatures(id);
        return {
          contract,
          signedRoles: signatures.map((s) => s.signerRole),
        };
      },
    );
    const itemId = (contract as { documensoItemId?: string | null })
      .documensoItemId;
    if (!itemId) {
      throw new NotFoundException(
        'Hợp đồng này chưa có tệp PDF trên hệ thống ký số Documenso',
      );
    }
    if (
      !isSignedPdfReady({
        documensoItemId: itemId,
        contractStatus: contract.contractStatus,
        signedRoles,
      })
    ) {
      throw new ConflictException(
        'Hợp đồng chưa hoàn tất đủ 4/4 chữ ký nên chưa thể xuất bản PDF đã ký. Vui lòng chờ cả bốn bên ký xong.',
      );
    }
    if (!this.documensoClient) {
      throw new ConflictException('Documenso client chưa được cấu hình');
    }
    const buffer = await this.documensoClient.downloadSignedItemPdf(itemId);
    return {
      buffer,
      filename: `${contract.contractNumber || contract.id}-signed.pdf`,
    };
  }

  async getFamilyGateStatus(actor: AuthenticatedUser) {
    if (actor.role !== 'FAMILY_REP') {
      throw new ForbiddenException('Chỉ tài khoản hộ gia đình mới có trạng thái cổng gói');
    }
    return this.repository.transaction(async (session) => {
      let familyId = actor.familyUnitId;
      if (!familyId) {
        const fam = await session.findFamilyByRepresentativeUserId?.(actor.id);
        familyId = fam?.id ?? null;
      }
      if (!familyId) {
        return {
          hasActiveContract: false,
          activeContract: null,
          pendingContract: null,
          familyUnit: null,
          patientCount: 0,
        };
      }
      const gate = (await session.findFamilyGateStatus?.(familyId)) ?? {
        activeContract: null,
        pendingContract: null,
        familyUnit: null,
        patientCount: 0,
      };
      return {
        hasActiveContract: Boolean(gate.activeContract),
        activeContract: gate.activeContract,
        pendingContract: gate.pendingContract,
        familyUnit: gate.familyUnit ?? null,
        patientCount: gate.patientCount,
      };
    });
  }
}
