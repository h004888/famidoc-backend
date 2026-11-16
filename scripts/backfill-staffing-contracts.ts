import '../src/core/config/load-environment';
import { PrismaClient } from '@prisma/client';
import { todayInVietnam } from '../src/core/business/business-helpers';

/**
 * Backfill `b2b_staffing_contracts` idempotent cho mọi cơ sở y tế đang `ACTIVE`.
 *
 * Bối cảnh: `PrismaPaymentsSession.contractEntity` chỉ cho phép thanh toán khi cơ sở
 * có hợp đồng cung ứng nhân lực B2B `ACTIVE` còn hiệu lực. Script này bảo đảm dữ liệu
 * đó luôn tồn tại để luồng `/booking/payment` không bị chặn `409` vì thiếu hợp đồng.
 *
 * Cách chạy:
 *   node -r ts-node/register scripts/backfill-staffing-contracts.ts --dry-run
 *   node -r ts-node/register scripts/backfill-staffing-contracts.ts
 *
 * Chạy lại nhiều lần không sinh bản ghi trùng: mỗi cơ sở chỉ được tạo tối đa một
 * hợp đồng backfill (mã `B2B-BACKFILL-<facilityId8>`), đã có thì bỏ qua.
 */

const BACKFILL_PREFIX = 'B2B-BACKFILL-';
// Tỷ lệ chuẩn của nền tảng: hoa hồng 15%, cơ sở hưởng 85% (khớp `prisma/seed.ts`).
const PLATFORM_COMMISSION_RATE = 15;
const FACILITY_REVENUE_RATE = 85;
const CONTRACT_DURATION_MONTHS = 12;

export interface TechBackfillOptions {
  dryRun?: boolean;
  now?: Date;
}

export interface TechBackfillStats {
  totalActiveFacilities: number;
  coveredFacilities: number;
  createdContracts: number;
  dryRun: boolean;
}

function backfillContractCode(facilityId: string): string {
  // Dùng toàn bộ UUID (bỏ dấu gạch) để hai cơ sở có tiền tố giống nhau
  // (ví dụ 20000000-…) không sinh trùng `contract_code`.
  return `${BACKFILL_PREFIX}${facilityId.replaceAll('-', '').toUpperCase()}`;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

export async function backfillStaffingContracts(
  prisma: PrismaClient,
  options: TechBackfillOptions = {},
): Promise<TechBackfillStats> {
  const dryRun = options.dryRun ?? false;
  const today = todayInVietnam(options.now);

  const facilities = await prisma.healthcareFacility.findMany({
    where: { verificationStatus: 'ACTIVE' },
    select: { id: true, facilityName: true },
    orderBy: { facilityName: 'asc' },
  });

  const stats: TechBackfillStats = {
    totalActiveFacilities: facilities.length,
    coveredFacilities: 0,
    createdContracts: 0,
    dryRun,
  };

  for (const facility of facilities) {
    // Chỉ xét hợp đồng đang hiệu lực đúng kỳ hạn mà payments kiểm tra.
    const active = await prisma.b2bStaffingContract.findFirst({
      where: {
        facilityId: facility.id,
        status: 'ACTIVE',
        startDate: { lte: today },
        endDate: { gt: today },
      },
      select: { id: true },
    });

    if (active) {
      stats.coveredFacilities += 1;
      continue;
    }

    const contractCode = backfillContractCode(facility.id);
    const existingBackfill = await prisma.b2bStaffingContract.findUnique({
      where: { contractCode },
      select: { id: true, status: true, startDate: true, endDate: true },
    });

    // Đã có bản ghi backfill nhưng không còn hiệu lực: gia hạn thay vì tạo trùng mã.
    if (existingBackfill) {
      const shouldExtend = existingBackfill.endDate <= today;
      if (shouldExtend) {
        console.log(
          `${dryRun ? '[dry-run] ' : ''}Gia hạn hợp đồng B2B ${contractCode} cho ${facility.facilityName} đến ${addMonths(today, CONTRACT_DURATION_MONTHS).toISOString().slice(0, 10)}`,
        );
        if (!dryRun) {
          await prisma.b2bStaffingContract.update({
            where: { id: existingBackfill.id },
            data: {
              status: 'ACTIVE',
              startDate: today,
              endDate: addMonths(today, CONTRACT_DURATION_MONTHS),
              platformCommissionRate: PLATFORM_COMMISSION_RATE,
              facilityRevenueRate: FACILITY_REVENUE_RATE,
            },
          });
        }
        stats.createdContracts += 1;
        stats.coveredFacilities += 1;
      }
      continue;
    }

    console.log(
      `${dryRun ? '[dry-run] ' : ''}Tạo hợp đồng B2B ${contractCode} cho ${facility.facilityName}`,
    );
    if (!dryRun) {
      await prisma.b2bStaffingContract.create({
        data: {
          contractCode,
          facilityId: facility.id,
          status: 'ACTIVE',
          startDate: today,
          endDate: addMonths(today, CONTRACT_DURATION_MONTHS),
          platformCommissionRate: PLATFORM_COMMISSION_RATE,
          facilityRevenueRate: FACILITY_REVENUE_RATE,
        },
      });
    }
    stats.createdContracts += 1;
    stats.coveredFacilities += 1;
  }

  return stats;
}

/**
 * Đếm số cơ sở `ACTIVE` chưa có hợp đồng B2B còn hiệu lực — kỳ vọng bằng 0 sau backfill.
 */
export async function countUncoveredActiveFacilities(
  prisma: PrismaClient,
  now?: Date,
): Promise<number> {
  const today = todayInVietnam(now);
  const uncovered = await prisma.healthcareFacility.count({
    where: {
      verificationStatus: 'ACTIVE',
      staffingContracts: {
        none: {
          status: 'ACTIVE',
          startDate: { lte: today },
          endDate: { gt: today },
        },
      },
    },
  });
  return uncovered;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();
  try {
    const stats = await backfillStaffingContracts(prisma, { dryRun });
    const uncovered = await countUncoveredActiveFacilities(prisma);
    console.log('--- KẾT QUẢ BACKFILL b2b_staffing_contracts ---');
    console.log(`Cơ sở ACTIVE: ${stats.totalActiveFacilities}`);
    console.log(`Đã có hợp đồng B2B hiệu lực: ${stats.coveredFacilities}`);
    console.log(
      `${dryRun ? 'Sẽ tạo/gia hạn' : 'Đã tạo/gia hạn'}: ${stats.createdContracts}`,
    );
    console.log(`Cơ sở ACTIVE còn thiếu hợp đồng hiệu lực: ${uncovered}`);
    if (!dryRun && uncovered > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Backfill b2b_staffing_contracts thất bại:', error);
    process.exit(1);
  });
}
