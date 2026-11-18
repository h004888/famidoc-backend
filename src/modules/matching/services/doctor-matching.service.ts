import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import {
  DoctorClinicalTier,
  MatchingQueueStatus,
  Prisma,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { PrismaService } from '../../../core/database/prisma.service';
import { CoreMailerService } from '../../../core/mailer/core-mailer.service';
import {
  buildActiveAndHeldWhere,
  computeQuotaMetrics,
  countActiveAndHeldMap,
} from '../../contracts/pricing/doctor-quota.helper';
import type {
  AssignQueueDoctorDto,
  CancelMatchingQueueDto,
  ListMatchingQueueQueryDto,
  MatchDoctorsIntakeDto,
} from '../dtos/matching.dto';
import { sanitizeMatchingText } from '../utils/pii-sanitizer.util';
import { JevClientService } from './jev-client.service';
import { MatchingConfigService } from './matching-config.service';

const DEFAULT_MIN_FIT_THRESHOLD = 0.6;
const DEFAULT_FIT_WEIGHT = 0.7;
const DEFAULT_VACANCY_WEIGHT = 0.3;
const DEFAULT_MAX_JEV_CANDIDATES = 10;
const DEFAULT_QUEUE_SLA_HOURS = 24;
const DEFAULT_SESSION_TTL_HOURS = 24;

export interface MatchedDoctorPreview {
  outcome: 'MATCHED';
  matchingSessionId: string;
  expiresAt: Date;
  jevModelVersion: string;
  scores: {
    jevFitScore: number;
    vacancyScore: number;
    compositeScore: number;
  };
  rationale: string;
  package: {
    id: string;
    packageCode: string;
    packageName: string;
    durationMonths: number;
    basePrice: number;
    includedMembers: number;
    maxMembers: number;
    additionalMemberMonthlyPrice: number;
    periodicVisitsQuota: number;
    telehealthQuota: number;
  };
  memberCount: number;
  doctor: {
    id: string;
    doctorName: string;
    specialty: string;
    academicTitle: string | null;
    experienceYears: number;
    clinicalTier: DoctorClinicalTier;
    ratingAvg: number;
    totalReviews: number;
    remainingSlots: number;
    maxPanelCapacity: number;
    avatarUrl: string | null;
  };
  facility: {
    id: string;
    facilityName: string;
    address: string;
    hotline: string;
  };
}

export interface QueuedMatchingResult {
  outcome: 'QUEUED';
  queueRequestId: string;
  status: MatchingQueueStatus;
  fallbackReason: string;
  slaExpiresAt: Date;
  packageId: string;
  memberCount: number;
  message: string;
}

@Injectable()
export class DoctorMatchingService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger(DoctorMatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jevClient: JevClientService,
    @Optional() private readonly mailer?: CoreMailerService,
    @Optional() private readonly matchingConfig?: MatchingConfigService,
  ) {}

  onApplicationBootstrap() {
    if (
      process.env.NODE_ENV === 'test' ||
      process.env.MATCHING_SLA_CLEANUP_ENABLED === 'false'
    ) {
      return;
    }
    const run = () => {
      void this.expireSlaQueueRequests().catch((err) =>
        this.logger.error(
          `Xử lý hết hạn SLA hàng chờ thất bại: ${(err as Error)?.message ?? err}`,
        ),
      );
    };
    this.timer = setInterval(run, 15 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private resolveNumberEnv(key: string, fallback: number): number {
    const num = Number(process.env[key]);
    return Number.isFinite(num) && num >= 0 ? num : fallback;
  }

  async matchDoctors(
    actor: AuthenticatedUser | undefined,
    dto: MatchDoctorsIntakeDto,
  ): Promise<MatchedDoctorPreview | QueuedMatchingResult> {
    const pkg = await this.prisma.servicePackage.findUnique({
      where: { id: dto.packageId },
    });
    if (!pkg || pkg.status !== 'ACTIVE' || pkg.deletedAt !== null) {
      throw new NotFoundException(
        'Gói chăm sóc sức khỏe không tồn tại hoặc đã ngừng áp dụng',
      );
    }

    if (
      dto.memberCount < pkg.includedMembers ||
      dto.memberCount > pkg.maxMembers
    ) {
      throw new BadRequestException(
        `Số lượng thành viên phải nằm trong khoảng từ ${pkg.includedMembers} đến ${pkg.maxMembers} người cho gói ${pkg.packageName}`,
      );
    }

    const ageGroups = (dto.ageGroups ?? []).map((s) => s.trim()).filter(Boolean);
    const careCategories = (dto.careCategories ?? [])
      .map((s) => s.trim())
      .filter(Boolean);
    const districtArea = sanitizeMatchingText(dto.districtArea) || null;
    const sanitizedDescription = sanitizeMatchingText(dto.careDescription);

    if (
      ageGroups.length === 0 &&
      careCategories.length === 0 &&
      !districtArea &&
      !sanitizedDescription
    ) {
      throw new BadRequestException(
        'Vui lòng chọn ít nhất một nhóm nhu cầu hoặc mô tả tình trạng sức khỏe gia đình',
      );
    }

    // 1. SQL Pre-filter: bác sĩ ACTIVE, CSYT ACTIVE, khớp trình độ nếu có
    const candidateRows = await this.prisma.doctor.findMany({
      where: {
        onboardingStatus: 'ACTIVE',
        facility: { verificationStatus: 'ACTIVE' },
        ...(dto.requestedTier ? { clinicalTier: dto.requestedTier } : {}),
      },
      include: {
        facility: {
          select: {
            id: true,
            facilityName: true,
            address: true,
            hotline: true,
          },
        },
        user: { select: { avatarUrl: true } },
        treatedCases: {
          where: { status: 'APPROVED' },
          take: 3,
          orderBy: { createdAt: 'desc' },
          select: { summary: true },
        },
      },
    });

    const activeHeldMap = await countActiveAndHeldMap(
      this.prisma,
      candidateRows.map((c) => c.id),
    );

    const openCandidates = candidateRows
      .map((doc) => {
        const heldCount = activeHeldMap.get(doc.id) ?? doc.activePanelCount ?? 0;
        const quota = computeQuotaMetrics(doc.maxPanelCapacity, heldCount);
        const vacancyScore =
          quota.maxCapacity > 0 ? quota.remainingSlots / quota.maxCapacity : 0;
        const areaMatch =
          districtArea &&
          doc.facility.address
            .toLowerCase()
            .includes(districtArea.toLowerCase())
            ? 1
            : 0;
        return {
          doc,
          quota,
          vacancyScore,
          areaMatch,
        };
      })
      .filter((item) => !item.quota.isQuotaFull)
      .sort((a, b) => {
        if (a.areaMatch !== b.areaMatch) return b.areaMatch - a.areaMatch;
        if (a.vacancyScore !== b.vacancyScore) {
          return b.vacancyScore - a.vacancyScore;
        }
        return Number(b.doc.ratingAvg) - Number(a.doc.ratingAvg);
      });

    const runtimeConfig = this.matchingConfig
      ? await this.matchingConfig.getEffectiveConfig()
      : null;

    const maxJevCandidates = Math.max(
      1,
      Math.floor(
        runtimeConfig?.maxCandidates ??
          this.resolveNumberEnv(
            'MAX_JEV_CANDIDATES',
            DEFAULT_MAX_JEV_CANDIDATES,
          ),
      ),
    );
    const shortlisted = openCandidates.slice(0, maxJevCandidates);

    const now = new Date();
    const sessionTtlHours = this.resolveNumberEnv(
      'MATCHING_SESSION_TTL_HOURS',
      DEFAULT_SESSION_TTL_HOURS,
    );
    const expiresAt = new Date(now.getTime() + sessionTtlHours * 3_600_000);

    if (shortlisted.length === 0) {
      return this.createQueueFallback({
        actor,
        pkg,
        memberCount: dto.memberCount,
        requestedTier: dto.requestedTier ?? null,
        ageGroups,
        careCategories,
        districtArea,
        sanitizedDescription,
        fallbackReason: 'NO_ELIGIBLE_CANDIDATES',
        expiresAt,
      });
    }

    // 2. Đánh giá phù hợp bằng TypeSafe Jev (Zero-PII)
    const jevResult = await this.jevClient.scoreCandidates({
      packageName: pkg.packageName,
      durationMonths: pkg.durationMonths,
      periodicVisitsQuota: pkg.periodicVisitsQuota,
      telehealthQuota: pkg.telehealthQuota,
      memberCount: dto.memberCount,
      requestedTier: dto.requestedTier ?? null,
      ageGroups,
      careCategories,
      districtArea,
      sanitizedDescription,
      candidates: shortlisted.map(({ doc }) => ({
        id: doc.id,
        clinicalTier: doc.clinicalTier,
        specialty: doc.specialty,
        academicTitle: doc.academicTitle,
        experienceYears: doc.experienceYears,
        bio: doc.bio,
        treatedCases: doc.treatedCases.map((tc) => tc.summary),
        facilityAddress: doc.facility.address,
        ratingAvg: Number(doc.ratingAvg),
      })),
    });

    if (!jevResult.ok) {
      return this.createQueueFallback({
        actor,
        pkg,
        memberCount: dto.memberCount,
        requestedTier: dto.requestedTier ?? null,
        ageGroups,
        careCategories,
        districtArea,
        sanitizedDescription,
        fallbackReason: jevResult.errorReason || 'JEV_UNAVAILABLE',
        expiresAt,
      });
    }

    // 3. Lọc ngưỡng tối thiểu + xếp hạng trọng số 70% Jev Fit + 30% Vacancy
    const minFit =
      runtimeConfig?.minFitThreshold ??
      this.resolveNumberEnv(
        'JEV_MIN_FIT_THRESHOLD',
        DEFAULT_MIN_FIT_THRESHOLD,
      );
    const fitWeight =
      runtimeConfig?.fitWeight ??
      this.resolveNumberEnv('JEV_FIT_WEIGHT', DEFAULT_FIT_WEIGHT);
    const vacancyWeight =
      runtimeConfig?.vacancyWeight ??
      this.resolveNumberEnv('JEV_VACANCY_WEIGHT', DEFAULT_VACANCY_WEIGHT);

    const scoreMap = new Map(
      jevResult.scores.map((item) => [item.doctorId, item]),
    );

    const ranked = shortlisted
      .map((candidate) => {
        const jevEntry = scoreMap.get(candidate.doc.id);
        const jevFitScore = jevEntry?.fitScore ?? 0;
        const compositeScore =
          fitWeight * jevFitScore + vacancyWeight * candidate.vacancyScore;
        return {
          ...candidate,
          jevFitScore,
          compositeScore,
          rationale: jevEntry?.rationale,
        };
      })
      .filter((entry) => entry.jevFitScore >= minFit)
      .sort((a, b) => {
        if (b.compositeScore !== a.compositeScore) {
          return b.compositeScore - a.compositeScore;
        }
        if (b.vacancyScore !== a.vacancyScore) {
          return b.vacancyScore - a.vacancyScore;
        }
        return Number(b.doc.ratingAvg) - Number(a.doc.ratingAvg);
      });

    if (ranked.length === 0) {
      return this.createQueueFallback({
        actor,
        pkg,
        memberCount: dto.memberCount,
        requestedTier: dto.requestedTier ?? null,
        ageGroups,
        careCategories,
        districtArea,
        sanitizedDescription,
        fallbackReason: 'BELOW_FIT_THRESHOLD',
        expiresAt,
        jevModelVersion: jevResult.modelVersion,
      });
    }

    const winner = ranked[0];
    const fitPercent = Math.round(winner.jevFitScore * 100);
    const defaultRationale =
      winner.rationale ||
      `Độ phù hợp ${fitPercent}% với chuyên khoa ${winner.doc.specialty} (${winner.doc.experienceYears} năm kinh nghiệm), còn ${winner.quota.remainingSlots}/${winner.quota.maxCapacity} slot hộ gia đình tại ${winner.doc.facility.facilityName}.`;

    const sessionRecord = await this.prisma.matchingSession.create({
      data: {
        userId: actor?.id ?? null,
        familyId: actor?.familyUnitId ?? null,
        packageId: pkg.id,
        memberCount: dto.memberCount,
        requestedTier: dto.requestedTier ?? null,
        ageGroups: ageGroups as unknown as Prisma.InputJsonValue,
        careCategories: careCategories as unknown as Prisma.InputJsonValue,
        districtArea,
        sanitizedDescription,
        matchedDoctorId: winner.doc.id,
        inferredFacilityId: winner.doc.facility.id,
        jevModelVersion: jevResult.modelVersion,
        jevFitScore: winner.jevFitScore.toFixed(4),
        vacancyScore: winner.vacancyScore.toFixed(4),
        compositeScore: winner.compositeScore.toFixed(4),
        rationale: defaultRationale,
        candidateSnapshots: ranked.slice(0, 5).map((r) => ({
          doctorId: r.doc.id,
          jevFitScore: Number(r.jevFitScore.toFixed(4)),
          vacancyScore: Number(r.vacancyScore.toFixed(4)),
          compositeScore: Number(r.compositeScore.toFixed(4)),
        })) as unknown as Prisma.InputJsonValue,
        status: 'MATCHED',
        expiresAt,
      },
    });

    return {
      outcome: 'MATCHED',
      matchingSessionId: sessionRecord.id,
      expiresAt: sessionRecord.expiresAt,
      jevModelVersion: jevResult.modelVersion,
      scores: {
        jevFitScore: Number(winner.jevFitScore.toFixed(4)),
        vacancyScore: Number(winner.vacancyScore.toFixed(4)),
        compositeScore: Number(winner.compositeScore.toFixed(4)),
      },
      rationale: defaultRationale,
      package: {
        id: pkg.id,
        packageCode: pkg.packageCode,
        packageName: pkg.packageName,
        durationMonths: pkg.durationMonths,
        basePrice: Number(pkg.basePrice),
        includedMembers: pkg.includedMembers,
        maxMembers: pkg.maxMembers,
        additionalMemberMonthlyPrice: Number(pkg.additionalMemberMonthlyPrice),
        periodicVisitsQuota: pkg.periodicVisitsQuota,
        telehealthQuota: pkg.telehealthQuota,
      },
      memberCount: dto.memberCount,
      doctor: {
        id: winner.doc.id,
        doctorName: winner.doc.doctorName,
        specialty: winner.doc.specialty,
        academicTitle: winner.doc.academicTitle,
        experienceYears: winner.doc.experienceYears,
        clinicalTier: winner.doc.clinicalTier,
        ratingAvg: Number(winner.doc.ratingAvg),
        totalReviews: winner.doc.totalReviews,
        remainingSlots: winner.quota.remainingSlots,
        maxPanelCapacity: winner.quota.maxCapacity,
        avatarUrl: winner.doc.user?.avatarUrl ?? null,
      },
      facility: winner.doc.facility,
    };
  }

  private async createQueueFallback(params: {
    actor: AuthenticatedUser | undefined;
    pkg: { id: string; packageName: string };
    memberCount: number;
    requestedTier: DoctorClinicalTier | null;
    ageGroups: string[];
    careCategories: string[];
    districtArea: string | null;
    sanitizedDescription: string;
    fallbackReason: string;
    expiresAt: Date;
    jevModelVersion?: string;
  }): Promise<QueuedMatchingResult> {
    const slaHours = this.resolveNumberEnv(
      'QUEUE_SLA_HOURS',
      DEFAULT_QUEUE_SLA_HOURS,
    );
    const slaExpiresAt = new Date(Date.now() + slaHours * 3_600_000);

    const { queueRequest, userEmail, userName } =
      await this.prisma.$transaction(async (tx) => {
        const session = await tx.matchingSession.create({
          data: {
            userId: params.actor?.id ?? null,
            familyId: params.actor?.familyUnitId ?? null,
            packageId: params.pkg.id,
            memberCount: params.memberCount,
            requestedTier: params.requestedTier,
            ageGroups: params.ageGroups as unknown as Prisma.InputJsonValue,
            careCategories:
              params.careCategories as unknown as Prisma.InputJsonValue,
            districtArea: params.districtArea,
            sanitizedDescription: params.sanitizedDescription,
            jevModelVersion: params.jevModelVersion ?? null,
            status: 'QUEUED',
            expiresAt: params.expiresAt,
          },
        });

        const queue = await tx.matchingQueueRequest.create({
          data: {
            matchingSessionId: session.id,
            userId: params.actor?.id ?? null,
            familyId: params.actor?.familyUnitId ?? null,
            packageId: params.pkg.id,
            memberCount: params.memberCount,
            requestedTier: params.requestedTier,
            ageGroups: params.ageGroups as unknown as Prisma.InputJsonValue,
            careCategories:
              params.careCategories as unknown as Prisma.InputJsonValue,
            districtArea: params.districtArea,
            sanitizedDescription: params.sanitizedDescription,
            fallbackReason: params.fallbackReason,
            status: 'QUEUED',
            slaExpiresAt,
          },
        });

        let recipientEmail: string | null = null;
        let recipientName: string | null = null;

        if (params.actor?.id) {
          const user = await tx.user.findUnique({
            where: { id: params.actor.id },
            select: { id: true, email: true, fullName: true },
          });
          recipientEmail = user?.email ?? null;
          recipientName = user?.fullName ?? null;

          await tx.notification.create({
            data: {
              userId: params.actor.id,
              title: 'Yêu cầu tìm bác sĩ đã vào hàng chờ điều phối',
              content: `Hệ thống đã ghi nhận yêu cầu gói ${params.pkg.packageName} (${params.memberCount} thành viên) vào hàng chờ Quản trị viên điều phối trong vòng ${slaHours} giờ.`,
              type: 'MATCHING_QUEUE_CREATED',
              referenceId: queue.id,
            },
          });
        }

        const admins = await tx.user.findMany({
          where: { role: 'ADMIN', status: 'ACTIVE' },
          select: { id: true },
        });
        if (admins.length > 0) {
          await tx.notification.createMany({
            data: admins.map((admin) => ({
              userId: admin.id,
              title: 'Có yêu cầu tìm bác sĩ mới trong hàng chờ điều phối',
              content: `Yêu cầu gói ${params.pkg.packageName} (${params.memberCount} thành viên) cần điều phối thủ công (${params.fallbackReason}).`,
              type: 'MATCHING_QUEUE_ADMIN_ALERT',
              referenceId: queue.id,
            })),
          });
        }

        return {
          queueRequest: queue,
          userEmail: recipientEmail,
          userName: recipientName,
        };
      });

    if (userEmail && this.mailer) {
      await this.sendEmailSafely({
        to: userEmail,
        subject: '[FamiDoc] Đã tiếp nhận yêu cầu tìm bác sĩ vào hàng chờ điều phối',
        text: `Xin chào ${userName ?? 'Quý khách'},\n\nYêu cầu tìm bác sĩ gia đình cho gói ${params.pkg.packageName} (${params.memberCount} thành viên) đã được chuyển vào hàng chờ điều phối của Quản trị viên FamiDoc (mã yêu cầu: ${queueRequest.id}).\nChúng tôi sẽ phân công bác sĩ phù hợp và gửi thông báo cho bạn trong vòng ${slaHours} giờ.\n`,
      });
    }

    return {
      outcome: 'QUEUED',
      queueRequestId: queueRequest.id,
      status: queueRequest.status,
      fallbackReason: queueRequest.fallbackReason,
      slaExpiresAt: queueRequest.slaExpiresAt,
      packageId: params.pkg.id,
      memberCount: params.memberCount,
      message:
        'Hiện chưa có bác sĩ đạt ngưỡng phù hợp tự động. Yêu cầu đã được chuyển tới Hàng chờ điều phối Admin.',
    };
  }

  async getMatchingSession(
    actor: AuthenticatedUser | undefined,
    sessionId: string,
  ) {
    const session = await this.prisma.matchingSession.findUnique({
      where: { id: sessionId },
      include: {
        servicePackage: true,
        matchedDoctor: {
          include: {
            facility: {
              select: {
                id: true,
                facilityName: true,
                address: true,
                hotline: true,
              },
            },
            user: { select: { avatarUrl: true } },
          },
        },
        inferredFacility: {
          select: {
            id: true,
            facilityName: true,
            address: true,
            hotline: true,
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Không tìm thấy phiên gợi ý bác sĩ');
    }

    if (
      session.userId &&
      actor &&
      actor.role !== 'ADMIN' &&
      session.userId !== actor.id
    ) {
      throw new ForbiddenException(
        'Bạn không có quyền truy cập phiên gợi ý bác sĩ này',
      );
    }

    if (session.status === 'QUEUED') {
      throw new ConflictException(
        'Phiên gợi ý này đã được chuyển sang hàng chờ điều phối Admin',
      );
    }

    if (session.expiresAt <= new Date() && session.status === 'MATCHED') {
      throw new ConflictException('Phiên gợi ý bác sĩ đã hết hạn');
    }

    let remainingSlots = 0;
    let isQuotaFull = true;
    if (session.matchedDoctor) {
      const heldMap = await countActiveAndHeldMap(this.prisma, [
        session.matchedDoctor.id,
      ]);
      const held =
        heldMap.get(session.matchedDoctor.id) ??
        session.matchedDoctor.activePanelCount ??
        0;
      const quota = computeQuotaMetrics(
        session.matchedDoctor.maxPanelCapacity,
        held,
      );
      remainingSlots = quota.remainingSlots;
      isQuotaFull = quota.isQuotaFull;
    }

    return {
      id: session.id,
      status: session.status,
      memberCount: session.memberCount,
      rationale: session.rationale,
      jevModelVersion: session.jevModelVersion,
      jevFitScore: session.jevFitScore ? Number(session.jevFitScore) : null,
      vacancyScore: session.vacancyScore ? Number(session.vacancyScore) : null,
      compositeScore: session.compositeScore
        ? Number(session.compositeScore)
        : null,
      expiresAt: session.expiresAt,
      contractId: session.contractId,
      package: {
        id: session.servicePackage.id,
        packageCode: session.servicePackage.packageCode,
        packageName: session.servicePackage.packageName,
        durationMonths: session.servicePackage.durationMonths,
        basePrice: Number(session.servicePackage.basePrice),
        includedMembers: session.servicePackage.includedMembers,
        maxMembers: session.servicePackage.maxMembers,
        additionalMemberMonthlyPrice: Number(
          session.servicePackage.additionalMemberMonthlyPrice,
        ),
        periodicVisitsQuota: session.servicePackage.periodicVisitsQuota,
        telehealthQuota: session.servicePackage.telehealthQuota,
      },
      doctor: session.matchedDoctor
        ? {
            id: session.matchedDoctor.id,
            doctorName: session.matchedDoctor.doctorName,
            specialty: session.matchedDoctor.specialty,
            academicTitle: session.matchedDoctor.academicTitle,
            experienceYears: session.matchedDoctor.experienceYears,
            clinicalTier: session.matchedDoctor.clinicalTier,
            ratingAvg: Number(session.matchedDoctor.ratingAvg),
            totalReviews: session.matchedDoctor.totalReviews,
            remainingSlots,
            isQuotaFull,
            maxPanelCapacity: session.matchedDoctor.maxPanelCapacity,
            avatarUrl: session.matchedDoctor.user?.avatarUrl ?? null,
          }
        : null,
      facility:
        session.inferredFacility ?? session.matchedDoctor?.facility ?? null,
    };
  }

  async listMyQueueRequests(actor: AuthenticatedUser) {
    const orFilters: Prisma.MatchingQueueRequestWhereInput[] = [
      { userId: actor.id },
    ];
    if (actor.familyUnitId) {
      orFilters.push({ familyId: actor.familyUnitId });
    }

    const items = await this.prisma.matchingQueueRequest.findMany({
      where: { OR: orFilters },
      orderBy: { createdAt: 'desc' },
      include: {
        servicePackage: {
          select: {
            id: true,
            packageCode: true,
            packageName: true,
            durationMonths: true,
            basePrice: true,
            includedMembers: true,
            maxMembers: true,
            additionalMemberMonthlyPrice: true,
          },
        },
        assignedDoctor: {
          select: {
            id: true,
            doctorName: true,
            specialty: true,
            academicTitle: true,
            experienceYears: true,
            clinicalTier: true,
          },
        },
        assignedFacility: {
          select: {
            id: true,
            facilityName: true,
            address: true,
            hotline: true,
          },
        },
      },
    });

    return { items, total: items.length };
  }

  async getQueueRequestDetail(actor: AuthenticatedUser, queueId: string) {
    const queue = await this.prisma.matchingQueueRequest.findUnique({
      where: { id: queueId },
      include: {
        servicePackage: true,
        assignedDoctor: {
          include: {
            user: { select: { avatarUrl: true } },
            facility: {
              select: {
                id: true,
                facilityName: true,
                address: true,
                hotline: true,
              },
            },
          },
        },
        assignedFacility: {
          select: {
            id: true,
            facilityName: true,
            address: true,
            hotline: true,
          },
        },
      },
    });

    if (!queue) {
      throw new NotFoundException('Không tìm thấy yêu cầu hàng chờ');
    }

    if (
      actor.role !== 'ADMIN' &&
      queue.userId !== actor.id &&
      (!actor.familyUnitId || queue.familyId !== actor.familyUnitId)
    ) {
      throw new ForbiddenException(
        'Bạn không có quyền xem yêu cầu hàng chờ này',
      );
    }

    let remainingSlots = 0;
    let isQuotaFull = true;
    if (queue.assignedDoctor) {
      const heldMap = await countActiveAndHeldMap(this.prisma, [
        queue.assignedDoctor.id,
      ]);
      const held =
        heldMap.get(queue.assignedDoctor.id) ??
        queue.assignedDoctor.activePanelCount ??
        0;
      const quota = computeQuotaMetrics(
        queue.assignedDoctor.maxPanelCapacity,
        held,
      );
      remainingSlots = quota.remainingSlots;
      isQuotaFull = quota.isQuotaFull;
    }

    return {
      ...queue,
      package: {
        id: queue.servicePackage.id,
        packageCode: queue.servicePackage.packageCode,
        packageName: queue.servicePackage.packageName,
        durationMonths: queue.servicePackage.durationMonths,
        basePrice: Number(queue.servicePackage.basePrice),
        includedMembers: queue.servicePackage.includedMembers,
        maxMembers: queue.servicePackage.maxMembers,
        additionalMemberMonthlyPrice: Number(
          queue.servicePackage.additionalMemberMonthlyPrice,
        ),
        periodicVisitsQuota: queue.servicePackage.periodicVisitsQuota,
        telehealthQuota: queue.servicePackage.telehealthQuota,
      },
      doctor: queue.assignedDoctor
        ? {
            id: queue.assignedDoctor.id,
            doctorName: queue.assignedDoctor.doctorName,
            specialty: queue.assignedDoctor.specialty,
            academicTitle: queue.assignedDoctor.academicTitle,
            experienceYears: queue.assignedDoctor.experienceYears,
            clinicalTier: queue.assignedDoctor.clinicalTier,
            ratingAvg: Number(queue.assignedDoctor.ratingAvg),
            totalReviews: queue.assignedDoctor.totalReviews,
            remainingSlots,
            isQuotaFull,
            maxPanelCapacity: queue.assignedDoctor.maxPanelCapacity,
            avatarUrl: queue.assignedDoctor.user?.avatarUrl ?? null,
          }
        : null,
      facility:
        queue.assignedFacility ?? queue.assignedDoctor?.facility ?? null,
    };
  }

  async cancelQueueRequest(
    actor: AuthenticatedUser,
    queueId: string,
    _dto: CancelMatchingQueueDto,
  ) {
    const queue = await this.prisma.matchingQueueRequest.findUnique({
      where: { id: queueId },
    });

    if (!queue) {
      throw new NotFoundException('Không tìm thấy yêu cầu hàng chờ');
    }

    if (
      actor.role !== 'ADMIN' &&
      queue.userId !== actor.id &&
      (!actor.familyUnitId || queue.familyId !== actor.familyUnitId)
    ) {
      throw new ForbiddenException(
        'Bạn không có quyền hủy yêu cầu hàng chờ này',
      );
    }

    if (queue.status !== 'QUEUED') {
      throw new ConflictException(
        'Chỉ có thể hủy yêu cầu đang ở trạng thái chờ điều phối (QUEUED)',
      );
    }

    const updated = await this.prisma.matchingQueueRequest.update({
      where: { id: queue.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    });

    return updated;
  }

  async listAdminQueueRequests(
    actor: AuthenticatedUser,
    query: ListMatchingQueueQueryDto,
  ) {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Chỉ Quản trị viên mới có quyền xem hàng chờ điều phối',
      );
    }

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const where: Prisma.MatchingQueueRequestWhereInput = query.status
      ? { status: query.status }
      : {};

    const [total, items] = await Promise.all([
      this.prisma.matchingQueueRequest.count({ where }),
      this.prisma.matchingQueueRequest.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        include: {
          servicePackage: {
            select: {
              id: true,
              packageCode: true,
              packageName: true,
              durationMonths: true,
            },
          },
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              phone: true,
            },
          },
          assignedDoctor: {
            select: {
              id: true,
              doctorName: true,
              specialty: true,
              clinicalTier: true,
            },
          },
          assignedFacility: {
            select: {
              id: true,
              facilityName: true,
              address: true,
            },
          },
        },
      }),
    ]);

    return { items, total, page, limit };
  }

  async assignQueueDoctor(
    actor: AuthenticatedUser,
    queueId: string,
    dto: AssignQueueDoctorDto,
    ip: string,
  ) {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Chỉ Quản trị viên mới có quyền phân công bác sĩ cho hàng chờ',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const queue = await tx.matchingQueueRequest.findUnique({
        where: { id: queueId },
        include: {
          servicePackage: {
            select: { id: true, packageName: true },
          },
          user: {
            select: { id: true, email: true, fullName: true },
          },
          familyUnit: {
            select: {
              id: true,
              representativeUser: {
                select: { id: true, email: true, fullName: true },
              },
            },
          },
        },
      });

      if (!queue) {
        throw new NotFoundException('Không tìm thấy yêu cầu hàng chờ');
      }

      if (queue.status !== 'QUEUED') {
        throw new ConflictException(
          'Yêu cầu hàng chờ không ở trạng thái QUEUED để phân công',
        );
      }

      const now = new Date();
      if (queue.slaExpiresAt <= now) {
        await tx.matchingQueueRequest.update({
          where: { id: queue.id },
          data: { status: 'EXPIRED' },
        });
        throw new ConflictException('Yêu cầu hàng chờ đã quá hạn SLA');
      }

      await tx.$queryRaw`SELECT id FROM doctors WHERE id=${dto.doctorId}::uuid FOR UPDATE`;
      const doctor = await tx.doctor.findUnique({
        where: { id: dto.doctorId },
        include: {
          facility: {
            select: {
              id: true,
              facilityName: true,
              verificationStatus: true,
            },
          },
        },
      });

      if (
        !doctor ||
        doctor.onboardingStatus !== 'ACTIVE' ||
        doctor.facility?.verificationStatus !== 'ACTIVE'
      ) {
        throw new BadRequestException(
          'Bác sĩ hoặc cơ sở y tế chưa ở trạng thái ACTIVE',
        );
      }

      const activeAndHeldCount = await tx.medicalContract.count({
        where: buildActiveAndHeldWhere(doctor.id, { now }),
      });
      const quota = computeQuotaMetrics(
        doctor.maxPanelCapacity,
        activeAndHeldCount,
      );

      if (quota.isQuotaFull) {
        throw new ConflictException(
          `Bác sĩ ${doctor.doctorName} đã kín slot hộ gia đình (${quota.maxCapacity}/${quota.maxCapacity}). Vui lòng chọn bác sĩ còn slot trống.`,
        );
      }

      const updated = await tx.matchingQueueRequest.update({
        where: { id: queue.id },
        data: {
          status: 'ASSIGNED',
          assignedDoctorId: doctor.id,
          assignedFacilityId: doctor.facilityId,
          assignedByUserId: actor.id,
          assignedAt: now,
          adminNote: dto.adminNote?.trim() || null,
        },
        include: {
          assignedDoctor: {
            select: {
              id: true,
              doctorName: true,
              specialty: true,
              clinicalTier: true,
            },
          },
          assignedFacility: {
            select: {
              id: true,
              facilityName: true,
              address: true,
            },
          },
        },
      });

      const targetUserId =
        queue.userId ?? queue.familyUnit?.representativeUser?.id ?? null;
      const targetEmail =
        queue.user?.email ?? queue.familyUnit?.representativeUser?.email ?? null;
      const targetName =
        queue.user?.fullName ??
        queue.familyUnit?.representativeUser?.fullName ??
        'Quý khách';

      if (targetUserId) {
        await tx.notification.create({
          data: {
            userId: targetUserId,
            title: 'Quản trị viên đã phân công bác sĩ cho yêu cầu của bạn',
            content: `Bác sĩ ${doctor.doctorName} (${doctor.facility.facilityName}) đã được phân công cho gói ${queue.servicePackage.packageName}. Vui lòng kiểm tra và xác nhận khởi tạo hợp đồng.`,
            type: 'MATCHING_QUEUE_ASSIGNED',
            referenceId: queue.id,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'ASSIGN_MATCHING_QUEUE_DOCTOR',
          resourceName: 'MatchingQueueRequest',
          resourceId: queue.id,
          clientIp: ip || '127.0.0.1',
          timestamp: now,
        },
      });

      return {
        updated,
        targetEmail,
        targetName,
        doctorName: doctor.doctorName,
        facilityName: doctor.facility.facilityName,
        packageName: queue.servicePackage.packageName,
      };
    });

    if (result.targetEmail && this.mailer) {
      const baseUrl = (process.env.APP_PUBLIC_URL || '').replace(/\/+$/, '');
      const confirmLink = baseUrl
        ? `${baseUrl}/booking?queueId=${result.updated.id}`
        : `/booking?queueId=${result.updated.id}`;
      await this.sendEmailSafely({
        to: result.targetEmail,
        subject: '[FamiDoc] Đã phân công bác sĩ gia đình — Mời xác nhận hợp đồng',
        text: `Xin chào ${result.targetName},\n\nQuản trị viên FamiDoc đã phân công bác sĩ ${result.doctorName} (${result.facilityName}) cho gói ${result.packageName}.\nVui lòng truy cập ${confirmLink} để xem thông tin bác sĩ và xác nhận khởi tạo hợp đồng 4 bên.\n`,
      });
    }

    return result.updated;
  }

  async expireSlaQueueRequests(now = new Date()): Promise<{ expired: number }> {
    const overdue = await this.prisma.matchingQueueRequest.findMany({
      where: {
        status: 'QUEUED',
        slaExpiresAt: { lte: now },
      },
      select: {
        id: true,
        userId: true,
      },
      take: 100,
    });

    if (overdue.length === 0) {
      return { expired: 0 };
    }

    let expiredCount = 0;
    for (const item of overdue) {
      const updated = await this.prisma.$transaction(async (tx) => {
        const res = await tx.matchingQueueRequest.updateMany({
          where: { id: item.id, status: 'QUEUED', slaExpiresAt: { lte: now } },
          data: { status: 'EXPIRED' },
        });
        if (res.count === 0) return false;
        if (item.userId) {
          await tx.notification.create({
            data: {
              userId: item.userId,
              title: 'Yêu cầu tìm bác sĩ trong hàng chờ đã hết hạn SLA',
              content:
                'Yêu cầu điều phối bác sĩ của bạn đã quá thời hạn xử lý SLA. Bạn có thể gửi lại yêu cầu ghép nối mới hoặc chọn trực tiếp bác sĩ đang còn slot.',
              type: 'MATCHING_QUEUE_EXPIRED',
              referenceId: item.id,
            },
          });
        }
        return true;
      });
      if (updated) expiredCount += 1;
    }

    return { expired: expiredCount };
  }

  private async sendEmailSafely(options: {
    to: string;
    subject: string;
    text: string;
  }) {
    if (!this.mailer?.sendMail) return;
    try {
      await this.mailer.sendMail(options);
    } catch (err) {
      this.logger.warn(
        `Không gửi được email thông báo hàng chờ tới ${options.to}: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}
