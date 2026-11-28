import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const CODE_PREFIX_PATTERN = /^[A-Za-z]\d/;

const icd10Select = {
  code: true,
  nameVi: true,
  nameEn: true,
  chapter: true,
  daggerAsterisk: true,
  allowedAsPrimary: true,
  longTermEligible: true,
} satisfies Prisma.Icd10CodeSelect;

export interface SearchIcd10Query {
  q: string;
  primaryOnly?: boolean;
  limit?: number;
}

@Injectable()
export class Icd10Service {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: SearchIcd10Query) {
    const q = query.q.trim();
    const take = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const isCodeQuery = CODE_PREFIX_PATTERN.test(q);

    const where: Prisma.Icd10CodeWhereInput = {
      isActive: true,
      ...(query.primaryOnly ? { allowedAsPrimary: true } : {}),
      ...(isCodeQuery
        ? { code: { startsWith: q.toUpperCase() } }
        : { nameVi: { contains: q, mode: 'insensitive' } }),
    };

    return this.prisma.icd10Code.findMany({
      where,
      orderBy: { code: 'asc' },
      take,
      select: icd10Select,
    });
  }

  async findActiveByCodes(codes: string[]) {
    const normalized = Array.from(
      new Set(codes.map((code) => code.trim().toUpperCase()).filter(Boolean)),
    );
    if (normalized.length === 0) {
      return [];
    }

    return this.prisma.icd10Code.findMany({
      where: {
        code: { in: normalized },
        isActive: true,
      },
      select: icd10Select,
    });
  }
}
