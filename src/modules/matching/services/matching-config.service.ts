import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { PrismaService } from '../../../core/database/prisma.service';
import type {
  SystemOneQuestionType,
  UpdateMatchingConfigDto,
} from '../dtos/matching-config.dto';

export const DEFAULT_SYSTEMONE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const DEFAULT_SYSTEMONE_MODEL = 'jev-1.14.0';
export const DEFAULT_SYSTEMONE_TIMEOUT_MS = 25000;
export const DEFAULT_SYSTEMONE_QUESTION_TYPE: SystemOneQuestionType = 'score';
export const DEFAULT_MAX_CANDIDATES = 10;
export const DEFAULT_MIN_FIT_THRESHOLD = 0.6;
export const DEFAULT_FIT_WEIGHT = 0.7;
export const DEFAULT_VACANCY_WEIGHT = 0.3;

export const MATCHING_CONFIG_KEYS = {
  ENABLED: 'MATCHING_SYSTEMONE_ENABLED',
  URL: 'MATCHING_SYSTEMONE_URL',
  MODEL: 'MATCHING_SYSTEMONE_MODEL',
  QUESTION_TYPE: 'MATCHING_SYSTEMONE_QUESTION_TYPE',
  API_KEY: 'MATCHING_SYSTEMONE_API_KEY',
  TIMEOUT_MS: 'MATCHING_SYSTEMONE_TIMEOUT_MS',
  MAX_CANDIDATES: 'MATCHING_MAX_CANDIDATES',
  MIN_FIT_THRESHOLD: 'MATCHING_MIN_FIT_THRESHOLD',
  FIT_WEIGHT: 'MATCHING_FIT_WEIGHT',
  VACANCY_WEIGHT: 'MATCHING_VACANCY_WEIGHT',
} as const;

const ALL_CONFIG_KEYS = Object.values(MATCHING_CONFIG_KEYS);

const KEY_DESCRIPTIONS: Record<string, string> = {
  [MATCHING_CONFIG_KEYS.ENABLED]: 'Bật/tắt model decision chuẩn System One cho Track B',
  [MATCHING_CONFIG_KEYS.URL]: 'Endpoint URL chuẩn POST /v1/systemone',
  [MATCHING_CONFIG_KEYS.MODEL]: 'Tên model decision trên endpoint System One',
  [MATCHING_CONFIG_KEYS.QUESTION_TYPE]: 'Loại câu hỏi System One (score hoặc noul)',
  [MATCHING_CONFIG_KEYS.API_KEY]: 'Bearer API Key cho endpoint System One (nếu cần)',
  [MATCHING_CONFIG_KEYS.TIMEOUT_MS]: 'Thời gian chờ tối đa khi gọi System One (ms)',
  [MATCHING_CONFIG_KEYS.MAX_CANDIDATES]: 'Số ứng viên tối đa gửi sang model mỗi lượt',
  [MATCHING_CONFIG_KEYS.MIN_FIT_THRESHOLD]: 'Ngưỡng điểm phù hợp tối thiểu [0..1]',
  [MATCHING_CONFIG_KEYS.FIT_WEIGHT]: 'Trọng số điểm phù hợp của model [0..1]',
  [MATCHING_CONFIG_KEYS.VACANCY_WEIGHT]: 'Trọng số độ trống slot đối tác [0..1]',
};

export interface EffectiveMatchingConfig {
  enabled: boolean;
  endpointUrl: string;
  modelName: string;
  questionType: SystemOneQuestionType;
  apiKey: string;
  apiKeySource: 'db' | 'env' | 'none';
  timeoutMs: number;
  maxCandidates: number;
  minFitThreshold: number;
  fitWeight: number;
  vacancyWeight: number;
  updatedAt: Date | null;
}

export interface AdminMatchingConfigView {
  enabled: boolean;
  endpointUrl: string;
  modelName: string;
  questionType: SystemOneQuestionType;
  hasApiKey: boolean;
  apiKeyMasked: string | null;
  apiKeySource: 'db' | 'env' | 'none';
  isLocalEndpoint: boolean;
  timeoutMs: number;
  maxCandidates: number;
  minFitThreshold: number;
  fitWeight: number;
  vacancyWeight: number;
  updatedAt: Date | null;
}

export interface DiscoveredSystemOneModel {
  name: string;
  parameterSize?: string;
  quantizationLevel?: string;
  capabilities?: string[];
  sizeBytes?: number;
}

export function isLocalSystemOneUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === 'host.docker.internal' ||
      host.endsWith('.local')
    );
  } catch {
    return false;
  }
}

export function isTypeSafeCloudUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    return host === 'api.typesafe.ai' || host.endsWith('.typesafe.ai');
  } catch {
    return false;
  }
}

export function assertSafeSystemOneUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BadRequestException(
      'Endpoint URL không hợp lệ. Vui lòng nhập URL đầy đủ bắt đầu bằng http:// hoặc https://.',
    );
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new BadRequestException(
      'Endpoint URL chỉ hỗ trợ giao thức http:// hoặc https://.',
    );
  }

  if (parsed.username || parsed.password) {
    throw new BadRequestException(
      'Endpoint URL không được chứa thông tin đăng nhập trực tiếp trên URL.',
    );
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) {
    throw new BadRequestException('Endpoint URL thiếu tên miền hoặc địa chỉ máy chủ.');
  }

  const blockedHosts = new Set([
    '0.0.0.0',
    '169.254.169.254',
    'metadata.google.internal',
    'metadata',
  ]);
  if (
    blockedHosts.has(host) ||
    host.startsWith('169.254.') ||
    host.startsWith('fe80:')
  ) {
    throw new BadRequestException(
      'Endpoint URL không được trỏ tới địa chỉ link-local hoặc metadata đám mây.',
    );
  }

  return parsed;
}

export function maskApiKey(raw?: string | null): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (value.length <= 8) return '****';
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

@Injectable()
export class MatchingConfigService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  private parseBoundedNumber(
    raw: string | undefined,
    fallback: number,
    min: number,
    max: number,
  ): number {
    if (raw === undefined || raw.trim() === '') return fallback;
    const num = Number(raw);
    if (!Number.isFinite(num) || num < min || num > max) return fallback;
    return num;
  }

  async getEffectiveConfig(): Promise<EffectiveMatchingConfig> {
    const dbMap = new Map<string, { value: string; updatedAt: Date }>();

    if (this.prisma?.systemConfiguration?.findMany) {
      const rows = await this.prisma.systemConfiguration.findMany({
        where: { configKey: { in: ALL_CONFIG_KEYS } },
        select: { configKey: true, configValue: true, updatedAt: true },
      });
      for (const row of rows) {
        dbMap.set(row.configKey, {
          value: row.configValue,
          updatedAt: row.updatedAt,
        });
      }
    }

    const enabledRaw =
      dbMap.get(MATCHING_CONFIG_KEYS.ENABLED)?.value ??
      process.env.TYPESAFE_JEV_ENABLED;
    const enabled = enabledRaw === 'false' ? false : true;

    const endpointUrl = (
      dbMap.get(MATCHING_CONFIG_KEYS.URL)?.value ||
      process.env.TYPESAFE_API_URL ||
      DEFAULT_SYSTEMONE_ENDPOINT
    ).trim();

    const modelName = (
      dbMap.get(MATCHING_CONFIG_KEYS.MODEL)?.value ||
      process.env.TYPESAFE_JEV_MODEL ||
      DEFAULT_SYSTEMONE_MODEL
    ).trim();

    const qTypeRaw = (
      dbMap.get(MATCHING_CONFIG_KEYS.QUESTION_TYPE)?.value ||
      process.env.TYPESAFE_JEV_QUESTION_TYPE ||
      DEFAULT_SYSTEMONE_QUESTION_TYPE
    )
      .trim()
      .toLowerCase();
    const questionType: SystemOneQuestionType =
      qTypeRaw === 'noul' ? 'noul' : 'score';

    const dbKeyEntry = dbMap.get(MATCHING_CONFIG_KEYS.API_KEY);
    const envKey = process.env.TYPESAFE_API_KEY?.trim() || '';
    let apiKey = '';
    let apiKeySource: 'db' | 'env' | 'none' = 'none';
    if (dbKeyEntry !== undefined) {
      apiKey = dbKeyEntry.value.trim();
      apiKeySource = apiKey ? 'db' : 'none';
    } else if (envKey) {
      apiKey = envKey;
      apiKeySource = 'env';
    }

    const timeoutMs = Math.floor(
      this.parseBoundedNumber(
        dbMap.get(MATCHING_CONFIG_KEYS.TIMEOUT_MS)?.value ??
          process.env.TYPESAFE_JEV_TIMEOUT_MS,
        DEFAULT_SYSTEMONE_TIMEOUT_MS,
        500,
        120000,
      ),
    );

    const maxCandidates = Math.floor(
      this.parseBoundedNumber(
        dbMap.get(MATCHING_CONFIG_KEYS.MAX_CANDIDATES)?.value ??
          process.env.MAX_JEV_CANDIDATES,
        DEFAULT_MAX_CANDIDATES,
        1,
        30,
      ),
    );

    const minFitThreshold = this.parseBoundedNumber(
      dbMap.get(MATCHING_CONFIG_KEYS.MIN_FIT_THRESHOLD)?.value ??
        process.env.JEV_MIN_FIT_THRESHOLD,
      DEFAULT_MIN_FIT_THRESHOLD,
      0,
      1,
    );

    const fitWeight = this.parseBoundedNumber(
      dbMap.get(MATCHING_CONFIG_KEYS.FIT_WEIGHT)?.value ??
        process.env.JEV_FIT_WEIGHT,
      DEFAULT_FIT_WEIGHT,
      0,
      1,
    );

    const vacancyWeight = this.parseBoundedNumber(
      dbMap.get(MATCHING_CONFIG_KEYS.VACANCY_WEIGHT)?.value ??
        process.env.JEV_VACANCY_WEIGHT,
      DEFAULT_VACANCY_WEIGHT,
      0,
      1,
    );

    let updatedAt: Date | null = null;
    for (const entry of dbMap.values()) {
      if (!updatedAt || entry.updatedAt > updatedAt) {
        updatedAt = entry.updatedAt;
      }
    }

    return {
      enabled,
      endpointUrl,
      modelName,
      questionType,
      apiKey,
      apiKeySource,
      timeoutMs,
      maxCandidates,
      minFitThreshold,
      fitWeight,
      vacancyWeight,
      updatedAt,
    };
  }

  toAdminView(config: EffectiveMatchingConfig): AdminMatchingConfigView {
    return {
      enabled: config.enabled,
      endpointUrl: config.endpointUrl,
      modelName: config.modelName,
      questionType: config.questionType,
      hasApiKey: Boolean(config.apiKey),
      apiKeyMasked: maskApiKey(config.apiKey),
      apiKeySource: config.apiKeySource,
      isLocalEndpoint: isLocalSystemOneUrl(config.endpointUrl),
      timeoutMs: config.timeoutMs,
      maxCandidates: config.maxCandidates,
      minFitThreshold: config.minFitThreshold,
      fitWeight: config.fitWeight,
      vacancyWeight: config.vacancyWeight,
      updatedAt: config.updatedAt,
    };
  }

  async getAdminConfig(actor: AuthenticatedUser): Promise<AdminMatchingConfigView> {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException('Chỉ Quản trị viên được xem cấu hình System One.');
    }
    const effective = await this.getEffectiveConfig();
    return this.toAdminView(effective);
  }

  async updateAdminConfig(
    actor: AuthenticatedUser,
    dto: UpdateMatchingConfigDto,
    clientIp: string,
  ): Promise<AdminMatchingConfigView> {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException('Chỉ Quản trị viên được thay đổi cấu hình System One.');
    }
    if (!this.prisma) {
      throw new BadRequestException('Không có kết nối cơ sở dữ liệu để lưu cấu hình.');
    }

    const current = await this.getEffectiveConfig();

    const nextEndpoint =
      dto.endpointUrl !== undefined
        ? assertSafeSystemOneUrl(dto.endpointUrl).toString()
        : current.endpointUrl;

    const nextModel =
      dto.modelName !== undefined ? dto.modelName.trim() : current.modelName;
    if (!nextModel) {
      throw new BadRequestException('Tên model không được để trống.');
    }

    const nextFitWeight = dto.fitWeight ?? current.fitWeight;
    const nextVacancyWeight = dto.vacancyWeight ?? current.vacancyWeight;
    if (Math.abs(nextFitWeight + nextVacancyWeight - 1) > 0.01) {
      throw new BadRequestException(
        'Tổng trọng số độ phù hợp model và độ trống slot phải bằng 1.00.',
      );
    }

    const upserts: Array<{ key: string; value: string }> = [];

    if (dto.enabled !== undefined) {
      upserts.push({
        key: MATCHING_CONFIG_KEYS.ENABLED,
        value: String(dto.enabled),
      });
    }
    if (dto.endpointUrl !== undefined) {
      upserts.push({
        key: MATCHING_CONFIG_KEYS.URL,
        value: nextEndpoint,
      });
    }
    if (dto.modelName !== undefined) {
      upserts.push({
        key: MATCHING_CONFIG_KEYS.MODEL,
        value: nextModel,
      });
    }
    if (dto.questionType !== undefined) {
      upserts.push({
        key: MATCHING_CONFIG_KEYS.QUESTION_TYPE,
        value: dto.questionType,
      });
    }
    if (dto.clearApiKey) {
      upserts.push({
        key: MATCHING_CONFIG_KEYS.API_KEY,
        value: '',
      });
    } else if (dto.apiKey !== undefined && dto.apiKey.trim() !== '') {
      upserts.push({
        key: MATCHING_CONFIG_KEYS.API_KEY,
        value: dto.apiKey.trim(),
      });
    }
    if (dto.timeoutMs !== undefined) {
      upserts.push({
        key: MATCHING_CONFIG_KEYS.TIMEOUT_MS,
        value: String(dto.timeoutMs),
      });
    }
    if (dto.maxCandidates !== undefined) {
      upserts.push({
        key: MATCHING_CONFIG_KEYS.MAX_CANDIDATES,
        value: String(dto.maxCandidates),
      });
    }
    if (dto.minFitThreshold !== undefined) {
      upserts.push({
        key: MATCHING_CONFIG_KEYS.MIN_FIT_THRESHOLD,
        value: String(dto.minFitThreshold),
      });
    }
    if (dto.fitWeight !== undefined) {
      upserts.push({
        key: MATCHING_CONFIG_KEYS.FIT_WEIGHT,
        value: String(dto.fitWeight),
      });
    }
    if (dto.vacancyWeight !== undefined) {
      upserts.push({
        key: MATCHING_CONFIG_KEYS.VACANCY_WEIGHT,
        value: String(dto.vacancyWeight),
      });
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of upserts) {
        await tx.systemConfiguration.upsert({
          where: { configKey: item.key },
          create: {
            configKey: item.key,
            configValue: item.value.slice(0, 255),
            description: KEY_DESCRIPTIONS[item.key] ?? item.key,
            updatedBy: actor.id,
          },
          update: {
            configValue: item.value.slice(0, 255),
            updatedBy: actor.id,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'ADMIN_UPDATE_MATCHING_CONFIG',
          resourceName: 'system_configurations',
          resourceId: 'matching_systemone',
          clientIp: clientIp.slice(0, 45),
          details: {
            endpointUrl: nextEndpoint,
            modelName: nextModel,
            questionType: dto.questionType ?? current.questionType,
            enabled: dto.enabled ?? current.enabled,
            timeoutMs: dto.timeoutMs ?? current.timeoutMs,
            maxCandidates: dto.maxCandidates ?? current.maxCandidates,
            minFitThreshold: dto.minFitThreshold ?? current.minFitThreshold,
            fitWeight: nextFitWeight,
            vacancyWeight: nextVacancyWeight,
            apiKeyChanged: Boolean(
              dto.clearApiKey || (dto.apiKey && dto.apiKey.trim()),
            ),
          },
        },
      });
    });

    const refreshed = await this.getEffectiveConfig();
    return this.toAdminView(refreshed);
  }

  async discoverOllamaModels(
    actor: AuthenticatedUser,
    endpointUrlOverride?: string,
  ): Promise<{
    reachable: boolean;
    origin: string;
    models: DiscoveredSystemOneModel[];
    message?: string;
  }> {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException('Chỉ Quản trị viên được quét danh sách model.');
    }

    const current = await this.getEffectiveConfig();
    const targetUrl = endpointUrlOverride?.trim() || current.endpointUrl;
    const parsed = assertSafeSystemOneUrl(targetUrl);
    const origin = parsed.origin;

    try {
      const response = await fetch(`${origin}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return {
          reachable: false,
          origin,
          models: [],
          message: `Máy chủ phản hồi HTTP ${response.status} tại ${origin}/api/tags (không phải Ollama hoặc không mở danh sách model).`,
        };
      }

      const payload = (await response.json()) as {
        models?: Array<{
          name?: string;
          model?: string;
          size?: number;
          capabilities?: string[];
          details?: {
            parameter_size?: string;
            quantization_level?: string;
          };
        }>;
      };

      const models: DiscoveredSystemOneModel[] = (payload.models ?? [])
        .map((m) => ({
          name: String(m.name ?? m.model ?? '').trim(),
          parameterSize: m.details?.parameter_size,
          quantizationLevel: m.details?.quantization_level,
          capabilities: Array.isArray(m.capabilities) ? m.capabilities : undefined,
          sizeBytes: typeof m.size === 'number' ? m.size : undefined,
        }))
        .filter((m) => m.name.length > 0);

      return {
        reachable: true,
        origin,
        models,
      };
    } catch (err) {
      return {
        reachable: false,
        origin,
        models: [],
        message: `Không thể kết nối tới ${origin}/api/tags: ${(err as Error)?.message ?? err}`,
      };
    }
  }
}
