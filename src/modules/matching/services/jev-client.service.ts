import { ForbiddenException, Injectable, Logger, Optional } from '@nestjs/common';
import { DoctorClinicalTier } from '@prisma/client';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import type {
  SystemOneQuestionType,
  TestMatchingConfigDto,
} from '../dtos/matching-config.dto';
import {
  assertSafeSystemOneUrl,
  DEFAULT_FIT_WEIGHT,
  DEFAULT_MAX_CANDIDATES,
  DEFAULT_MIN_FIT_THRESHOLD,
  DEFAULT_SYSTEMONE_ENDPOINT,
  DEFAULT_SYSTEMONE_MODEL,
  DEFAULT_SYSTEMONE_QUESTION_TYPE,
  DEFAULT_SYSTEMONE_TIMEOUT_MS,
  DEFAULT_VACANCY_WEIGHT,
  type EffectiveMatchingConfig,
  isTypeSafeCloudUrl,
  MatchingConfigService,
} from './matching-config.service';

export interface JevCandidateInput {
  id: string;
  clinicalTier: DoctorClinicalTier;
  specialty: string;
  academicTitle: string | null;
  experienceYears: number;
  bio: string | null;
  treatedCases: string[];
  facilityAddress: string;
  ratingAvg: number;
}

export interface JevEvaluationInput {
  packageName: string;
  durationMonths: number;
  periodicVisitsQuota: number;
  telehealthQuota: number;
  memberCount: number;
  requestedTier?: DoctorClinicalTier | null;
  ageGroups: string[];
  careCategories: string[];
  districtArea?: string | null;
  sanitizedDescription: string;
  candidates: JevCandidateInput[];
}

export interface JevCandidateScore {
  doctorId: string;
  fitScore: number;
  confidence?: number;
  rationale?: string;
}

export interface JevEvaluationResult {
  ok: boolean;
  modelVersion: string;
  scores: JevCandidateScore[];
  errorReason?: string;
}

export interface SystemOneConnectionTestResult {
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  endpointUrl: string;
  modelName: string;
  resolvedModel: string | null;
  questionType: SystemOneQuestionType;
  sampleScores: Array<{
    doctorId: string;
    label: string;
    fitScore: number;
    confidence?: number;
  }>;
  errorMessage?: string;
}

const SCORE_CRITERIA_5_LEVELS = [
  'Không phù hợp',
  'Ít phù hợp',
  'Trung bình',
  'Khá phù hợp',
  'Rất phù hợp',
] as const;

const MAX_BIO_CHARS = 200;

@Injectable()
export class JevClientService {
  private readonly logger = new Logger(JevClientService.name);

  constructor(
    @Optional() private readonly matchingConfig?: MatchingConfigService,
  ) {}

  getModelVersion(): string {
    return (process.env.TYPESAFE_JEV_MODEL || DEFAULT_SYSTEMONE_MODEL).trim();
  }

  private resolveEnvFallbackConfig(): EffectiveMatchingConfig {
    const timeoutRaw = Number(process.env.TYPESAFE_JEV_TIMEOUT_MS);
    const maxCandRaw = Number(process.env.MAX_JEV_CANDIDATES);
    const minFitRaw = Number(process.env.JEV_MIN_FIT_THRESHOLD);
    const fitWeightRaw = Number(process.env.JEV_FIT_WEIGHT);
    const vacancyWeightRaw = Number(process.env.JEV_VACANCY_WEIGHT);
    const qTypeRaw = (process.env.TYPESAFE_JEV_QUESTION_TYPE || '')
      .trim()
      .toLowerCase();

    return {
      enabled: process.env.TYPESAFE_JEV_ENABLED !== 'false',
      endpointUrl: (
        process.env.TYPESAFE_API_URL || DEFAULT_SYSTEMONE_ENDPOINT
      ).trim(),
      modelName: this.getModelVersion(),
      questionType:
        qTypeRaw === 'noul' ? 'noul' : DEFAULT_SYSTEMONE_QUESTION_TYPE,
      apiKey: process.env.TYPESAFE_API_KEY?.trim() || '',
      apiKeySource: process.env.TYPESAFE_API_KEY?.trim() ? 'env' : 'none',
      timeoutMs:
        Number.isFinite(timeoutRaw) && timeoutRaw > 500
          ? timeoutRaw
          : DEFAULT_SYSTEMONE_TIMEOUT_MS,
      maxCandidates:
        Number.isFinite(maxCandRaw) && maxCandRaw >= 1
          ? Math.floor(maxCandRaw)
          : DEFAULT_MAX_CANDIDATES,
      minFitThreshold:
        Number.isFinite(minFitRaw) && minFitRaw >= 0 && minFitRaw <= 1
          ? minFitRaw
          : DEFAULT_MIN_FIT_THRESHOLD,
      fitWeight:
        Number.isFinite(fitWeightRaw) && fitWeightRaw >= 0 && fitWeightRaw <= 1
          ? fitWeightRaw
          : DEFAULT_FIT_WEIGHT,
      vacancyWeight:
        Number.isFinite(vacancyWeightRaw) &&
        vacancyWeightRaw >= 0 &&
        vacancyWeightRaw <= 1
          ? vacancyWeightRaw
          : DEFAULT_VACANCY_WEIGHT,
      updatedAt: null,
    };
  }

  private async resolveConfig(): Promise<EffectiveMatchingConfig> {
    if (this.matchingConfig) {
      return this.matchingConfig.getEffectiveConfig();
    }
    return this.resolveEnvFallbackConfig();
  }

  private truncateText(text: string | null | undefined, maxLen: number): string {
    const clean = (text ?? '').replace(/\s+/g, ' ').trim();
    if (!clean) return 'Không có mô tả thêm';
    return clean.length > maxLen ? `${clean.slice(0, maxLen - 1)}…` : clean;
  }

  buildSystemOneStateText(input: JevEvaluationInput): string {
    const lines: string[] = [
      `[GÓI DỊCH VỤ] ${input.packageName} | Thời hạn: ${input.durationMonths} tháng | Khám định kỳ: ${input.periodicVisitsQuota} lượt | Telehealth: ${input.telehealthQuota} lượt | Số thành viên: ${input.memberCount} người.`,
      `[NHU CẦU HỘ GIA ĐÌNH] Trình độ bác sĩ mong muốn: ${input.requestedTier ?? 'Bất kỳ'} | Nhóm đối tượng: ${input.ageGroups.join(', ') || 'Không nêu'} | Nhóm bệnh lý/chăm sóc: ${input.careCategories.join(', ') || 'Không nêu'} | Khu vực: ${input.districtArea || 'Không giới hạn'} | Mô tả chi tiết: ${input.sanitizedDescription || 'Không có mô tả thêm'}.`,
      '[DANH SÁCH BÁC SĨ ỨNG VIÊN]',
    ];

    for (const c of input.candidates) {
      const cases =
        c.treatedCases.length > 0
          ? c.treatedCases.slice(0, 3).join('; ')
          : 'Chưa ghi nhận ca điển hình';
      lines.push(
        `- ID=${c.id} | Hạng=${c.clinicalTier} | Chuyên khoa=${c.specialty} | Học hàm=${c.academicTitle ?? 'BS'} | Kinh nghiệm=${c.experienceYears} năm | Đánh giá=${c.ratingAvg}/5 | Cơ sở=${c.facilityAddress} | Giới thiệu=${this.truncateText(c.bio, MAX_BIO_CHARS)} | Ca đã xử lý=${cases}`,
      );
    }

    return lines.join('\n');
  }

  private buildSystemOneQuestions(
    candidates: JevCandidateInput[],
    questionType: SystemOneQuestionType,
  ): Record<string, Record<string, unknown>> {
    const questions: Record<string, Record<string, unknown>> = {};
    for (const c of candidates) {
      if (questionType === 'noul') {
        questions[c.id] = {
          type: 'noul',
          instructions: `Bác sĩ ${c.id} có phù hợp với gói dịch vụ và nhu cầu chăm sóc của hộ gia đình không?`,
          criteria: {
            true: 'Bác sĩ phù hợp về chuyên khoa, kinh nghiệm, ca bệnh, trình độ và khu vực phục vụ.',
            false: 'Bác sĩ không phù hợp chuyên khoa, trình độ hoặc quá lệch nhu cầu gia đình.',
          },
        };
      } else {
        questions[c.id] = {
          type: 'score',
          instructions: `Chấm điểm độ phù hợp của bác sĩ ${c.id} dựa trên chuyên khoa, kinh nghiệm, ca bệnh đã điều trị, khu vực cơ sở y tế và nhu cầu chăm sóc của hộ gia đình.`,
          criteria: [...SCORE_CRITERIA_5_LEVELS],
        };
      }
    }
    return questions;
  }

  private async invokeSystemOne(
    input: JevEvaluationInput,
    config: EffectiveMatchingConfig,
  ): Promise<{
    httpStatus: number | null;
    modelVersion: string;
    scores: JevCandidateScore[];
    errorReason?: string;
    errorMessage?: string;
  }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    const payload = {
      model: config.modelName,
      state: this.buildSystemOneStateText(input),
      questions: this.buildSystemOneQuestions(
        input.candidates,
        config.questionType,
      ),
    };

    try {
      const response = await fetch(config.endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        this.logger.warn(
          `System One phản hồi HTTP ${response.status} (${config.endpointUrl}); chuyển sang fallback hàng chờ Admin.`,
        );
        return {
          httpStatus: response.status,
          modelVersion: config.modelName,
          scores: [],
          errorReason: 'JEV_UNAVAILABLE',
          errorMessage: errBody
            ? `HTTP ${response.status}: ${errBody.slice(0, 200)}`
            : `HTTP ${response.status}`,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const scores = this.parseJevScores(
        data,
        input.candidates,
        config.questionType,
      );
      if (scores.length === 0) {
        return {
          httpStatus: response.status,
          modelVersion: config.modelName,
          scores: [],
          errorReason: 'JEV_UNAVAILABLE',
          errorMessage:
            'Phản hồi JSON từ endpoint không chứa điểm answers hợp lệ theo chuẩn System One.',
        };
      }

      return {
        httpStatus: response.status,
        modelVersion:
          typeof data.model === 'string' && data.model.trim()
            ? data.model.trim()
            : config.modelName,
        scores,
      };
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      this.logger.warn(
        `Gọi System One thất bại (${message}); chuyển sang fallback hàng chờ Admin.`,
      );
      return {
        httpStatus: null,
        modelVersion: config.modelName,
        scores: [],
        errorReason: 'JEV_UNAVAILABLE',
        errorMessage: message,
      };
    }
  }

  async scoreCandidates(
    input: JevEvaluationInput,
  ): Promise<JevEvaluationResult> {
    const config = await this.resolveConfig();
    if (!config.enabled) {
      return {
        ok: false,
        modelVersion: config.modelName,
        scores: [],
        errorReason: 'JEV_UNAVAILABLE',
      };
    }

    if (!config.apiKey && isTypeSafeCloudUrl(config.endpointUrl)) {
      return {
        ok: false,
        modelVersion: config.modelName,
        scores: [],
        errorReason: 'JEV_UNAVAILABLE',
      };
    }

    const res = await this.invokeSystemOne(input, config);
    if (res.scores.length === 0 || res.errorReason) {
      return {
        ok: false,
        modelVersion: res.modelVersion,
        scores: [],
        errorReason: res.errorReason || 'JEV_UNAVAILABLE',
      };
    }

    return {
      ok: true,
      modelVersion: res.modelVersion,
      scores: res.scores,
    };
  }

  async testSystemOneConnection(
    actor: AuthenticatedUser,
    dto: TestMatchingConfigDto,
  ): Promise<SystemOneConnectionTestResult> {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Chỉ Quản trị viên được phép kiểm thử kết nối model System One.',
      );
    }

    const base = await this.resolveConfig();
    const endpointUrl = dto.endpointUrl?.trim()
      ? assertSafeSystemOneUrl(dto.endpointUrl).toString()
      : assertSafeSystemOneUrl(base.endpointUrl).toString();
    const modelName = (dto.modelName?.trim() || base.modelName).trim();
    const questionType: SystemOneQuestionType =
      dto.questionType ?? base.questionType;
    const apiKey = dto.clearApiKey
      ? ''
      : dto.apiKey !== undefined && dto.apiKey.trim() !== ''
        ? dto.apiKey.trim()
        : base.apiKey;
    const timeoutMs = dto.timeoutMs ?? base.timeoutMs;

    const testConfig: EffectiveMatchingConfig = {
      ...base,
      enabled: true,
      endpointUrl,
      modelName,
      questionType,
      apiKey,
      timeoutMs,
    };

    const sampleInput: JevEvaluationInput = {
      packageName: 'Gói Chăm Sóc Tim Mạch Gia Đình',
      durationMonths: 3,
      periodicVisitsQuota: 3,
      telehealthQuota: 20,
      memberCount: 4,
      requestedTier: DoctorClinicalTier.SENIOR,
      ageGroups: ['Người cao tuổi'],
      careCategories: ['Tăng huyết áp / Tim mạch'],
      districtArea: 'Quận 1, TP.HCM',
      sanitizedDescription:
        'Theo dõi huyết áp và tim mạch định kỳ tại nhà cho ông bà ở Quận 1.',
      candidates: [
        {
          id: 'doc-match',
          clinicalTier: DoctorClinicalTier.SENIOR,
          specialty: 'Tim mạch - Lão khoa',
          academicTitle: 'PGS.TS.BS',
          experienceYears: 15,
          bio: 'Chuyên sâu điều trị tăng huyết áp, suy tim và chăm sóc người cao tuổi tại nhà.',
          treatedCases: ['Kiểm soát tăng huyết áp kháng trị ở bệnh nhân 75 tuổi'],
          facilityAddress: 'Quận 1, TP.HCM',
          ratingAvg: 4.9,
        },
        {
          id: 'doc-mismatch',
          clinicalTier: DoctorClinicalTier.JUNIOR,
          specialty: 'Da liễu thẩm mỹ',
          academicTitle: 'BS',
          experienceYears: 1,
          bio: 'Chăm sóc da và điều trị mụn ngoại trú.',
          treatedCases: ['Điều trị viêm da cơ địa nhẹ'],
          facilityAddress: 'Huyện Củ Chi, TP.HCM',
          ratingAvg: 4.2,
        },
      ],
    };

    const startedAt = Date.now();
    if (!testConfig.apiKey && isTypeSafeCloudUrl(testConfig.endpointUrl)) {
      return {
        ok: false,
        httpStatus: null,
        latencyMs: Date.now() - startedAt,
        endpointUrl,
        modelName,
        resolvedModel: null,
        questionType,
        sampleScores: [],
        errorMessage:
          'Endpoint TypeSafe Cloud yêu cầu API Key (TYPESAFE_API_KEY) trước khi kiểm tra kết nối.',
      };
    }

    const res = await this.invokeSystemOne(sampleInput, testConfig);
    const latencyMs = Date.now() - startedAt;

    const labels: Record<string, string> = {
      'doc-match': 'Mẫu khớp cao (Tim mạch, Quận 1)',
      'doc-mismatch': 'Mẫu lệch chuyên khoa (Da liễu, Củ Chi)',
    };

    return {
      ok: res.scores.length > 0 && !res.errorReason,
      httpStatus: res.httpStatus,
      latencyMs,
      endpointUrl,
      modelName,
      resolvedModel: res.scores.length > 0 ? res.modelVersion : null,
      questionType,
      sampleScores: res.scores.map((s) => ({
        doctorId: s.doctorId,
        label: labels[s.doctorId] ?? s.doctorId,
        fitScore: Number(s.fitScore.toFixed(4)),
        confidence:
          s.confidence !== undefined
            ? Number(s.confidence.toFixed(4))
            : undefined,
      })),
      errorMessage: res.errorMessage,
    };
  }

  private normalizeScoreValue(
    rawValue: number,
    legend?: Record<string, unknown>,
  ): number {
    if (legend && typeof legend === 'object') {
      const levels = Object.keys(legend).length;
      if (levels >= 2) {
        return Math.max(0, Math.min(1, rawValue / (levels - 1)));
      }
    }
    const scaled =
      rawValue > 1 && rawValue <= 100 ? rawValue / 100 : rawValue;
    return Math.max(0, Math.min(1, scaled));
  }

  private parseJevScores(
    data: Record<string, unknown>,
    candidates: JevCandidateInput[],
    questionType: SystemOneQuestionType,
  ): JevCandidateScore[] {
    const candidateIds = new Set(candidates.map((c) => c.id));
    const parsed: JevCandidateScore[] = [];

    const rawList = Array.isArray(data.answers)
      ? data.answers
      : Array.isArray(data.results)
        ? data.results
        : Array.isArray(data.scores)
          ? data.scores
          : null;

    if (rawList) {
      for (const item of rawList) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        const doctorId = String(
          row.id ?? row.questionId ?? row.doctorId ?? '',
        ).trim();
        if (!candidateIds.has(doctorId)) continue;

        const rowType =
          typeof row.type === 'string'
            ? row.type.toLowerCase()
            : questionType;
        const rawScore =
          rowType === 'noul'
            ? Number(row.noul ?? row.score ?? row.value ?? row.answer)
            : Number(row.score ?? row.value ?? row.answer ?? row.noul);
        if (!Number.isFinite(rawScore)) continue;

        const legend =
          row.legend && typeof row.legend === 'object'
            ? (row.legend as Record<string, unknown>)
            : undefined;
        const confidence = Number(row.confidence);

        parsed.push({
          doctorId,
          fitScore:
            rowType === 'noul'
              ? Math.max(0, Math.min(1, rawScore))
              : this.normalizeScoreValue(rawScore, legend),
          confidence: Number.isFinite(confidence) ? confidence : undefined,
          rationale:
            typeof row.rationale === 'string'
              ? row.rationale
              : typeof row.reason === 'string'
                ? row.reason
                : undefined,
        });
      }
      return parsed;
    }

    if (data.answers && typeof data.answers === 'object') {
      for (const [doctorId, value] of Object.entries(
        data.answers as Record<string, unknown>,
      )) {
        if (!candidateIds.has(doctorId)) continue;

        if (typeof value === 'number') {
          if (!Number.isFinite(value)) continue;
          parsed.push({
            doctorId,
            fitScore: this.normalizeScoreValue(value),
          });
          continue;
        }

        if (typeof value !== 'object' || value === null) continue;
        const obj = value as Record<string, unknown>;
        const answerType =
          typeof obj.type === 'string'
            ? obj.type.toLowerCase()
            : questionType;

        if (answerType === 'noul' || obj.noul !== undefined) {
          const noulVal = Number(obj.noul ?? obj.score ?? obj.value);
          if (!Number.isFinite(noulVal)) continue;
          const confidence = Number(obj.confidence);
          parsed.push({
            doctorId,
            fitScore: Math.max(0, Math.min(1, noulVal)),
            confidence: Number.isFinite(confidence) ? confidence : undefined,
            rationale:
              typeof obj.rationale === 'string'
                ? obj.rationale
                : typeof obj.reason === 'string'
                  ? obj.reason
                  : undefined,
          });
          continue;
        }

        const numeric = Number(obj.score ?? obj.value);
        if (!Number.isFinite(numeric)) continue;
        const legend =
          obj.legend && typeof obj.legend === 'object'
            ? (obj.legend as Record<string, unknown>)
            : undefined;
        const confidence = Number(obj.confidence);

        parsed.push({
          doctorId,
          fitScore: this.normalizeScoreValue(numeric, legend),
          confidence: Number.isFinite(confidence) ? confidence : undefined,
          rationale:
            typeof obj.rationale === 'string'
              ? obj.rationale
              : typeof obj.reason === 'string'
                ? obj.reason
                : undefined,
        });
      }
    }

    return parsed;
  }
}
