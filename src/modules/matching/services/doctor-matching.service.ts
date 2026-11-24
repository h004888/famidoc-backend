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
import { resolveAppPublicUrl } from '../../../core/mailer/templates/famidoc-email-layout';
import {
  buildMatchingQueueAssignedEmail,
} from '../../../core/mailer/templates/matching-email.templates';
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

const DEFAULT_FIT_WEIGHT = 0.7;
const DEFAULT_VACANCY_WEIGHT = 0.3;
const DEFAULT_MAX_JEV_CANDIDATES = 10;
const DEFAULT_SESSION_TTL_HOURS = 24;

export interface MatchedDoctorSummary {
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
}

export interface MatchedFacilitySummary {
  id: string;
  facilityName: string;
  address: string;
  hotline: string;
}

export interface MatchingComparisonRow {
  criterion: string;
  familyNeed: string;
  doctorMatch: string;
  isMatched: boolean;
}

export interface MatchedDoctorAlternative {
  rank: number;
  scores: {
    jevFitScore: number;
    vacancyScore: number;
    compositeScore: number;
  };
  rationale: string;
  shortReason: string;
  doctor: MatchedDoctorSummary;
  facility: MatchedFacilitySummary;
}

export interface MatchedDoctorPreview {
  outcome: 'MATCHED';
  matchingSessionId: string;
  expiresAt: Date;
  jevModelVersion: string;
  rankingSource: 'AI' | 'FALLBACK';
  relaxedAcademicTitle: boolean;
  requestedAcademicTitle: string | null;
  scores: {
    jevFitScore: number;
    vacancyScore: number;
    compositeScore: number;
  };
  rationale: string;
  comparisonRows: MatchingComparisonRow[];
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
  doctor: MatchedDoctorSummary;
  facility: MatchedFacilitySummary;
  alternatives: MatchedDoctorAlternative[];
}

export interface PlatformFullMatchingResult {
  outcome: 'PLATFORM_FULL';
  packageId: string;
  memberCount: number;
  hotline: string;
  message: string;
}

const MATCHING_AGE_GROUPS = [
  { id: 'children', label: 'Trẻ nhỏ (<12 tuổi)' },
  { id: 'adults', label: 'Người lớn (12–59 tuổi)' },
  { id: 'elderly', label: 'Người cao tuổi (≥60 tuổi)' },
  { id: 'maternity', label: 'Mẹ bầu & sau sinh' },
] as const;

const MATCHING_CARE_CATEGORIES = [
  {
    id: 'routine_family',
    label: 'Khám định kỳ cả nhà',
    specialtyKeywords: ['gia đình', 'đa khoa', 'nội tổng quát'],
  },
  {
    id: 'cardiology',
    label: 'Tim mạch · Huyết áp',
    specialtyKeywords: ['tim mạch', 'nội', 'lão khoa'],
  },
  {
    id: 'endocrinology',
    label: 'Tiểu đường · Nội tiết',
    specialtyKeywords: ['nội tiết', 'nội', 'gia đình'],
  },
  {
    id: 'pediatrics',
    label: 'Nhi · Dinh dưỡng',
    specialtyKeywords: ['nhi', 'dinh dưỡng'],
  },
  {
    id: 'respiratory_ent',
    label: 'Hô hấp · Tai mũi họng',
    specialtyKeywords: ['hô hấp', 'tai mũi họng', 'nội'],
  },
  {
    id: 'musculoskeletal_rehab',
    label: 'Xương khớp · Phục hồi',
    specialtyKeywords: ['cơ xương khớp', 'phục hồi chức năng', 'chấn thương'],
  },
] as const;

const MATCHING_ACADEMIC_TITLES = [
  { value: 'BS', label: 'Bác sĩ (BS)', desc: 'Bác sĩ đa khoa có chứng chỉ hành nghề' },
  { value: 'BSNT', label: 'Bác sĩ Nội trú (BSNT)', desc: 'Đào tạo nội trú chuyên sâu tại bệnh viện lớn' },
  { value: 'ThS.BS', label: 'Thạc sĩ Bác sĩ (ThS.BS)', desc: 'Trình độ Thạc sĩ Y học' },
  { value: 'BS.CKI', label: 'Bác sĩ Chuyên khoa I (BS.CKI)', desc: 'Chuyên khoa cấp I thực hành lâm sàng' },
  { value: 'BS.CKII', label: 'Bác sĩ Chuyên khoa II (BS.CKII)', desc: 'Chuyên khoa cấp II chuyên sâu' },
  { value: 'TS.BS', label: 'Tiến sĩ Bác sĩ (TS.BS)', desc: 'Học vị Tiến sĩ Y học' },
  { value: 'PGS.TS.BS', label: 'Phó Giáo sư · Tiến sĩ (PGS.TS.BS)', desc: 'Học hàm Phó Giáo sư' },
  { value: 'GS.TS.BS', label: 'Giáo sư · Tiến sĩ (GS.TS.BS)', desc: 'Học hàm Giáo sư' },
] as const;

const PROVINCES_V2_URL = 'https://provinces.open-api.vn/api/v2/?depth=2';
const PROVINCES_V2_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface ProvinceV2Ward {
  name: string;
}

interface ProvinceV2Item {
  name: string;
  wards?: ProvinceV2Ward[];
}

function normalizeCityLabel(raw: string): string {
  const cleaned = raw.trim();
  if (/^(tp\.?\s*hcm|hcm|tp\.?\s*hồ chí minh|thành phố hồ chí minh|hồ chí minh)$/i.test(cleaned)) {
    return 'Hồ Chí Minh';
  }
  if (/^(hn|hà nội|tp\.?\s*hà nội|thành phố hà nội)$/i.test(cleaned)) {
    return 'Hà Nội';
  }
  if (/^(đn|đà nẵng|tp\.?\s*đà nẵng|thành phố đà nẵng)$/i.test(cleaned)) {
    return 'Đà Nẵng';
  }
  return cleaned
    .replace(/^(thành phố|tỉnh|tp\.?)\s+/i, '')
    .trim();
}

function normalizeWardLabel(raw: string): string {
  return raw
    .trim()
    .replace(/^(phường|xã|thị trấn|quận|huyện|thành phố|thị xã)\s+/i, '')
    .trim()
    .toLowerCase();
}

function computeAreaMatchScore(
  facilityAddress: string,
  districtArea: string | null,
): number {
  if (!districtArea) return 0;
  const addrLower = facilityAddress.toLowerCase();
  const rawLower = districtArea.trim().toLowerCase();
  if (addrLower.includes(rawLower)) {
    return 2;
  }

  const parts = districtArea
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    const wardNorm = normalizeWardLabel(parts[0]!);
    const cityNorm = normalizeCityLabel(parts[parts.length - 1]!).toLowerCase();
    const hasCity = Boolean(cityNorm) && addrLower.includes(cityNorm);
    const hasWard = Boolean(wardNorm) && addrLower.includes(wardNorm);
    if (hasCity && hasWard) return 2;
    if (hasCity) return 1;
    if (hasWard) return 1;
    return 0;
  }

  const singleCity = normalizeCityLabel(districtArea).toLowerCase();
  if (singleCity && addrLower.includes(singleCity)) return 1;
  const singleWard = normalizeWardLabel(districtArea);
  if (singleWard && addrLower.includes(singleWard)) return 1;
  return 0;
}

function computeSpecialtyKeywordMatch(
  doc: {
    specialty: string;
    bio: string | null;
    treatedCases: Array<{ summary: string }>;
  },
  careCategories: string[],
): number {
  if (careCategories.length === 0) return 0;
  const keywords = new Set<string>();
  for (const cat of careCategories) {
    const lowerCat = cat.toLowerCase();
    for (const token of lowerCat.split(/[·,/]+/)) {
      const cleaned = token.trim();
      if (cleaned.length >= 2) keywords.add(cleaned);
    }
    const matchedDef = MATCHING_CARE_CATEGORIES.find(
      (def) => def.label.toLowerCase() === lowerCat,
    );
    if (matchedDef) {
      for (const kw of matchedDef.specialtyKeywords) {
        keywords.add(kw.toLowerCase());
      }
    }
  }
  const haystack = [
    doc.specialty,
    doc.bio ?? '',
    ...doc.treatedCases.map((tc) => tc.summary),
  ]
    .join(' ')
    .toLowerCase();

  let score = 0;
  for (const kw of keywords) {
    if (haystack.includes(kw)) score += 1;
  }
  return score;
}

function buildFallbackRationale(params: {
  specialty: string;
  experienceYears: number;
  facilityName: string;
  facilityAddress: string;
  areaMatch: number;
  specialtyKeywordMatch: number;
  remainingSlots: number;
  maxCapacity: number;
}): string {
  const parts: string[] = [];
  if (params.areaMatch >= 2) {
    parts.push(`Đúng khu vực bạn chọn (${params.facilityAddress})`);
  } else if (params.areaMatch === 1) {
    parts.push(`Cùng tỉnh/thành phố (${params.facilityAddress})`);
  }
  if (params.specialtyKeywordMatch > 0) {
    parts.push(`Sát nhu cầu với chuyên khoa ${params.specialty}`);
  } else {
    parts.push(`Chuyên khoa ${params.specialty} (${params.experienceYears} năm kinh nghiệm)`);
  }
  parts.push(
    `Còn ${params.remainingSlots}/${params.maxCapacity} chỗ trống tại ${params.facilityName}`,
  );
  return parts.join(' · ');
}

function parseAddressArea(address: string): { city: string; district: string } | null {
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const city = normalizeCityLabel(parts[parts.length - 1]!);
  const district = parts[parts.length - 2]!;
  if (!city || !district) return null;
  return { city, district };
}

@Injectable()
export class DoctorMatchingService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private provincesV2Cache: {
    expiresAt: number;
    areas: Array<{ city: string; districts: string[] }>;
  } | null = null;
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

  private async fetchProvincesV2Areas(): Promise<
    Array<{ city: string; districts: string[] }> | null
  > {
    if (
      this.provincesV2Cache &&
      this.provincesV2Cache.expiresAt > Date.now()
    ) {
      return this.provincesV2Cache.areas;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(PROVINCES_V2_URL, {
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as ProvinceV2Item[];
      if (!Array.isArray(payload) || payload.length === 0) return null;

      const areas = payload
        .filter((item) => Boolean(item?.name))
        .map((item) => ({
          city: item.name.trim(),
          districts: Array.isArray(item.wards)
            ? item.wards
                .map((w) => w?.name?.trim())
                .filter((name): name is string => Boolean(name))
                .sort((a, b) => a.localeCompare(b, 'vi'))
            : [],
        }))
        .sort((a, b) => a.city.localeCompare(b.city, 'vi'));

      this.provincesV2Cache = {
        expiresAt: Date.now() + PROVINCES_V2_CACHE_TTL_MS,
        areas,
      };
      return areas;
    } catch (err) {
      this.logger.warn(
        `Không thể tải danh mục hành chính v2 từ provinces.open-api.vn: ${(err as Error)?.message ?? err}`,
      );
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getMatchingOptions() {
    const v2Areas = await this.fetchProvincesV2Areas();
    if (v2Areas && v2Areas.length > 0) {
      return {
        areas: v2Areas,
        ageGroups: MATCHING_AGE_GROUPS,
        careCategories: MATCHING_CARE_CATEGORIES,
        academicTitles: MATCHING_ACADEMIC_TITLES,
      };
    }

    const activeDoctors = await this.prisma.doctor.findMany({
      where: {
        onboardingStatus: 'ACTIVE',
        facility: { verificationStatus: 'ACTIVE' },
      },
      select: {
        id: true,
        activePanelCount: true,
        maxPanelCapacity: true,
        facility: {
          select: {
            address: true,
          },
        },
      },
    });

    const activeHeldMap = await countActiveAndHeldMap(
      this.prisma,
      activeDoctors.map((d) => d.id),
    );

    const cityDistrictMap = new Map<string, Set<string>>();
    for (const doc of activeDoctors) {
      const heldCount = activeHeldMap.get(doc.id) ?? doc.activePanelCount ?? 0;
      const quota = computeQuotaMetrics(doc.maxPanelCapacity, heldCount);
      if (quota.isQuotaFull) continue;

      const parsed = parseAddressArea(doc.facility.address);
      if (!parsed) continue;

      if (!cityDistrictMap.has(parsed.city)) {
        cityDistrictMap.set(parsed.city, new Set());
      }
      cityDistrictMap.get(parsed.city)!.add(parsed.district);
    }

    const areas = Array.from(cityDistrictMap.entries())
      .map(([city, districts]) => ({
        city,
        districts: Array.from(districts).sort((a, b) => a.localeCompare(b, 'vi')),
      }))
      .sort((a, b) => a.city.localeCompare(b.city, 'vi'));

    return {
      areas,
      ageGroups: MATCHING_AGE_GROUPS,
      careCategories: MATCHING_CARE_CATEGORIES,
      academicTitles: MATCHING_ACADEMIC_TITLES,
    };
  }

  async matchDoctors(
    actor: AuthenticatedUser | undefined,
    dto: MatchDoctorsIntakeDto,
  ): Promise<MatchedDoctorPreview | PlatformFullMatchingResult> {
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

    // 1. Truy vấn nới lỏng 2 tầng (Progressive 2-Tier Query)
    const requestedAcademicTitle = dto.requestedAcademicTitle?.trim() || null;
    const doctorInclude = {
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
        where: { status: 'APPROVED' as const },
        take: 3,
        orderBy: { createdAt: 'desc' as const },
        select: { summary: true },
      },
    };

    const tier1Rows = await this.prisma.doctor.findMany({
      where: {
        onboardingStatus: 'ACTIVE',
        facility: { verificationStatus: 'ACTIVE' },
        ...(dto.requestedTier ? { clinicalTier: dto.requestedTier } : {}),
        ...(requestedAcademicTitle
          ? {
              academicTitle: {
                contains: requestedAcademicTitle,
                mode: 'insensitive',
              },
            }
          : {}),
      },
      include: doctorInclude,
    });

    const hasQualificationFilter = Boolean(
      requestedAcademicTitle || dto.requestedTier,
    );
    const tier1Ids = new Set(tier1Rows.map((d) => d.id));
    let relaxedAcademicTitle = false;
    let combinedRows = tier1Rows.map((doc) => ({ doc, tierRank: 1 as 1 | 2 }));

    if (hasQualificationFilter && tier1Rows.length < 4) {
      const tier2Rows = await this.prisma.doctor.findMany({
        where: {
          onboardingStatus: 'ACTIVE',
          facility: { verificationStatus: 'ACTIVE' },
          ...(tier1Ids.size > 0
            ? { id: { notIn: Array.from(tier1Ids) } }
            : {}),
        },
        include: doctorInclude,
      });
      const newTier2Rows = tier2Rows.filter((d) => !tier1Ids.has(d.id));
      if (newTier2Rows.length > 0) {
        relaxedAcademicTitle = true;
        combinedRows = [
          ...combinedRows,
          ...newTier2Rows.map((doc) => ({ doc, tierRank: 2 as 1 | 2 })),
        ];
      }
    }

    const activeHeldMap = await countActiveAndHeldMap(
      this.prisma,
      combinedRows.map((c) => c.doc.id),
    );

    const openCandidates = combinedRows
      .map(({ doc, tierRank }) => {
        const heldCount = activeHeldMap.get(doc.id) ?? doc.activePanelCount ?? 0;
        const quota = computeQuotaMetrics(doc.maxPanelCapacity, heldCount);
        const vacancyScore =
          quota.maxCapacity > 0 ? quota.remainingSlots / quota.maxCapacity : 0;
        const areaMatch = computeAreaMatchScore(
          doc.facility.address,
          districtArea,
        );
        const specialtyKeywordMatch = computeSpecialtyKeywordMatch(
          doc,
          careCategories,
        );
        return {
          doc,
          tierRank,
          quota,
          vacancyScore,
          areaMatch,
          specialtyKeywordMatch,
        };
      })
      .filter((item) => !item.quota.isQuotaFull)
      .sort((a, b) => {
        if (a.tierRank !== b.tierRank) return a.tierRank - b.tierRank;
        if (a.areaMatch !== b.areaMatch) return b.areaMatch - a.areaMatch;
        if (a.specialtyKeywordMatch !== b.specialtyKeywordMatch) {
          return b.specialtyKeywordMatch - a.specialtyKeywordMatch;
        }
        if (a.vacancyScore !== b.vacancyScore) {
          return b.vacancyScore - a.vacancyScore;
        }
        return Number(b.doc.ratingAvg) - Number(a.doc.ratingAvg);
      });

    if (
      hasQualificationFilter &&
      openCandidates.some((c) => c.tierRank === 2)
    ) {
      relaxedAcademicTitle = true;
    }

    const runtimeConfig = this.matchingConfig
      ? await this.matchingConfig.getEffectiveConfig()
      : null;

    const maxJevCandidates = Math.max(
      4,
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
      return {
        outcome: 'PLATFORM_FULL',
        packageId: pkg.id,
        memberCount: dto.memberCount,
        hotline: '1900 8821',
        message:
          'Hiện toàn bộ bác sĩ trên hệ thống đều đã kín lịch nhận gia đình. Vui lòng gọi Hotline 1900 8821 để được hỗ trợ hoặc xem lại danh sách bác sĩ sau.',
      };
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

    // 3. Xếp hạng Top 1 + Top 2-4 (AI hoặc Fallback tất định khi AI lỗi/tắt)
    const fitWeight =
      runtimeConfig?.fitWeight ??
      this.resolveNumberEnv('JEV_FIT_WEIGHT', DEFAULT_FIT_WEIGHT);
    const vacancyWeight =
      runtimeConfig?.vacancyWeight ??
      this.resolveNumberEnv('JEV_VACANCY_WEIGHT', DEFAULT_VACANCY_WEIGHT);

    let rankingSource: 'AI' | 'FALLBACK' = 'AI';
    let jevModelVersion = jevResult.modelVersion || 'deterministic-fallback';

    let ranked: Array<
      (typeof shortlisted)[number] & {
        jevFitScore: number;
        compositeScore: number;
        rationale: string;
      }
    >;

    if (jevResult.ok) {
      const scoreMap = new Map(
        jevResult.scores.map((item) => [item.doctorId, item]),
      );
      ranked = shortlisted
        .map((candidate) => {
          const jevEntry = scoreMap.get(candidate.doc.id);
          const jevFitScore = jevEntry?.fitScore ?? 0;
          const compositeScore =
            fitWeight * jevFitScore + vacancyWeight * candidate.vacancyScore;
          const fitPercent = Math.round(jevFitScore * 100);
          const rationale =
            jevEntry?.rationale ||
            `Độ phù hợp ${fitPercent}% với chuyên khoa ${candidate.doc.specialty} (${candidate.doc.experienceYears} năm kinh nghiệm), còn ${candidate.quota.remainingSlots}/${candidate.quota.maxCapacity} slot hộ gia đình tại ${candidate.doc.facility.facilityName}.`;
          return {
            ...candidate,
            jevFitScore,
            compositeScore,
            rationale,
          };
        })
        .sort((a, b) => {
          if (b.compositeScore !== a.compositeScore) {
            return b.compositeScore - a.compositeScore;
          }
          if (b.areaMatch !== a.areaMatch) {
            return b.areaMatch - a.areaMatch;
          }
          if (b.vacancyScore !== a.vacancyScore) {
            return b.vacancyScore - a.vacancyScore;
          }
          return Number(b.doc.ratingAvg) - Number(a.doc.ratingAvg);
        });
    } else {
      rankingSource = 'FALLBACK';
      jevModelVersion = 'deterministic-fallback';
      ranked = [...shortlisted]
        .sort((a, b) => {
          if (a.areaMatch !== b.areaMatch) return b.areaMatch - a.areaMatch;
          if (a.specialtyKeywordMatch !== b.specialtyKeywordMatch) {
            return b.specialtyKeywordMatch - a.specialtyKeywordMatch;
          }
          if (a.vacancyScore !== b.vacancyScore) {
            return b.vacancyScore - a.vacancyScore;
          }
          return Number(b.doc.ratingAvg) - Number(a.doc.ratingAvg);
        })
        .map((candidate) => {
          const areaFactor = candidate.areaMatch / 2;
          const keywordFactor = Math.min(1, candidate.specialtyKeywordMatch / 3);
          const jevFitScore = Number(
            (0.5 * areaFactor + 0.5 * keywordFactor).toFixed(4),
          );
          const compositeScore = Number(
            (
              fitWeight * jevFitScore +
              vacancyWeight * candidate.vacancyScore
            ).toFixed(4),
          );
          return {
            ...candidate,
            jevFitScore,
            compositeScore,
            rationale: buildFallbackRationale({
              specialty: candidate.doc.specialty,
              experienceYears: candidate.doc.experienceYears,
              facilityName: candidate.doc.facility.facilityName,
              facilityAddress: candidate.doc.facility.address,
              areaMatch: candidate.areaMatch,
              specialtyKeywordMatch: candidate.specialtyKeywordMatch,
              remainingSlots: candidate.quota.remainingSlots,
              maxCapacity: candidate.quota.maxCapacity,
            }),
          };
        });
    }

    const winner = ranked[0]!;
    const defaultRationale = winner.rationale;

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
        jevModelVersion,
        jevFitScore: winner.jevFitScore.toFixed(4),
        vacancyScore: winner.vacancyScore.toFixed(4),
        compositeScore: winner.compositeScore.toFixed(4),
        rationale: defaultRationale,
        candidateSnapshots: ranked.slice(0, 4).map((r) => ({
          doctorId: r.doc.id,
          jevFitScore: Number(r.jevFitScore.toFixed(4)),
          vacancyScore: Number(r.vacancyScore.toFixed(4)),
          compositeScore: Number(r.compositeScore.toFixed(4)),
        })) as unknown as Prisma.InputJsonValue,
        status: 'MATCHED',
        expiresAt,
      },
    });

    const toDoctorSummary = (
      entry: (typeof ranked)[number],
    ): MatchedDoctorSummary => ({
      id: entry.doc.id,
      doctorName: entry.doc.doctorName,
      specialty: entry.doc.specialty,
      academicTitle: entry.doc.academicTitle,
      experienceYears: entry.doc.experienceYears,
      clinicalTier: entry.doc.clinicalTier,
      ratingAvg: Number(entry.doc.ratingAvg),
      totalReviews: entry.doc.totalReviews,
      remainingSlots: entry.quota.remainingSlots,
      maxPanelCapacity: entry.quota.maxCapacity,
      avatarUrl: entry.doc.user?.avatarUrl ?? null,
    });

    const buildAlternativeReason = (entry: (typeof ranked)[number]): string => {
      if (entry.tierRank > winner.tierRank && requestedAcademicTitle) {
        return `Kinh nghiệm tốt (${entry.doc.experienceYears} năm), nhưng khác học vị ${requestedAcademicTitle} bạn ưu tiên.`;
      }
      if (entry.areaMatch < winner.areaMatch && districtArea) {
        return `Sát chuyên môn nhưng hiện ở khác khu vực bạn chọn (${entry.doc.facility.address}).`;
      }
      if (entry.specialtyKeywordMatch < winner.specialtyKeywordMatch) {
        return `Bác sĩ ${entry.doc.specialty} giàu kinh nghiệm, nhưng chuyên khoa ít sát nhu cầu chính hơn Top 1.`;
      }
      if (entry.vacancyScore < winner.vacancyScore) {
        return `Phù hợp nhu cầu gia đình nhưng còn ít lịch trống hơn bác sĩ Top 1.`;
      }
      return `Lựa chọn phù hợp tiếp theo tại ${entry.doc.facility.facilityName} (${entry.doc.experienceYears} năm kinh nghiệm).`;
    };

    const comparisonRows: MatchingComparisonRow[] = [
      {
        criterion: 'Nhu cầu sức khỏe',
        familyNeed:
          careCategories.length > 0
            ? careCategories.join(', ')
            : 'Chăm sóc sức khỏe gia đình',
        doctorMatch:
          winner.specialtyKeywordMatch > 0
            ? `Khớp chuyên khoa ${winner.doc.specialty}`
            : `Chuyên khoa ${winner.doc.specialty} (${winner.doc.experienceYears} năm KN)`,
        isMatched: winner.specialtyKeywordMatch > 0 || winner.jevFitScore >= 0.6,
      },
      {
        criterion: 'Khu vực sống',
        familyNeed: districtArea || 'Mọi khu vực',
        doctorMatch:
          winner.areaMatch >= 2
            ? `Đúng khu vực (${winner.doc.facility.address})`
            : winner.areaMatch === 1
              ? `Cùng tỉnh/TP (${winner.doc.facility.address})`
              : districtArea
                ? `Hỗ trợ từ xa (${winner.doc.facility.address})`
                : winner.doc.facility.address,
        isMatched: !districtArea || winner.areaMatch >= 1,
      },
      {
        criterion: 'Học hàm / Học vị',
        familyNeed: requestedAcademicTitle || 'Linh hoạt phù hợp nhất',
        doctorMatch:
          !requestedAcademicTitle || winner.tierRank === 1
            ? `Đúng học vị ${winner.doc.academicTitle || 'BS'}`
            : `Mở rộng sang ${winner.doc.academicTitle || 'BS'}`,
        isMatched: !requestedAcademicTitle || winner.tierRank === 1,
      },
      {
        criterion: 'Lịch nhận hộ',
        familyNeed: 'Cần tiếp nhận ngay',
        doctorMatch:
          winner.vacancyScore >= 0.5
            ? 'Đang còn nhiều lịch trống'
            : 'Đang còn lịch trống nhận gia đình',
        isMatched: true,
      },
    ];

    const alternatives: MatchedDoctorAlternative[] = ranked
      .slice(1, 4)
      .map((entry, idx) => ({
        rank: idx + 2,
        scores: {
          jevFitScore: Number(entry.jevFitScore.toFixed(4)),
          vacancyScore: Number(entry.vacancyScore.toFixed(4)),
          compositeScore: Number(entry.compositeScore.toFixed(4)),
        },
        rationale: entry.rationale,
        shortReason: buildAlternativeReason(entry),
        doctor: toDoctorSummary(entry),
        facility: entry.doc.facility,
      }));

    return {
      outcome: 'MATCHED',
      matchingSessionId: sessionRecord.id,
      expiresAt: sessionRecord.expiresAt,
      jevModelVersion,
      rankingSource,
      relaxedAcademicTitle,
      requestedAcademicTitle,
      scores: {
        jevFitScore: Number(winner.jevFitScore.toFixed(4)),
        vacancyScore: Number(winner.vacancyScore.toFixed(4)),
        compositeScore: Number(winner.compositeScore.toFixed(4)),
      },
      rationale: defaultRationale,
      comparisonRows,
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
      doctor: toDoctorSummary(winner),
      facility: winner.doc.facility,
      alternatives,
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
      await this.sendEmailSafely({
        to: result.targetEmail,
        ...buildMatchingQueueAssignedEmail({
          recipientName: result.targetName,
          doctorName: result.doctorName,
          facilityName: result.facilityName,
          packageName: result.packageName,
          confirmUrl: resolveAppPublicUrl(
            `/booking?queueId=${result.updated.id}`,
          ),
        }),
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
    html?: string;
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
