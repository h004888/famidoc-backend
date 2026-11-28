import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { ContractErrorCode } from '../../../core/constants/error-codes.constant';
import { PrismaService } from '../../../core/database/prisma.service';
import { ResourceNotFoundException } from '../../../core/exceptions/api.exception';

const latestContractSelect = {
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  take: 1,
  select: {
    id: true,
    contractNumber: true,
    contractStatus: true,
    startDate: true,
    endDate: true,
    servicePackage: { select: { packageName: true } },
  },
} satisfies Prisma.FamilyUnit$medicalContractsArgs;

type LatestContractRow = {
  id: string;
  contractNumber: string;
  contractStatus: string;
  startDate: Date;
  endDate: Date;
  servicePackage: { packageName: string };
};

function toContract(contract: LatestContractRow | undefined) {
  return contract
    ? {
        id: contract.id,
        contractNumber: contract.contractNumber,
        status: contract.contractStatus,
        packageName: contract.servicePackage.packageName,
        startDate: contract.startDate,
        endDate: contract.endDate,
      }
    : null;
}

/**
 * Hộ gia đình có hợp đồng y tế với bác sĩ đang đăng nhập.
 * Mỗi bác sĩ phụ trách số ít gia đình (≤5) nên danh sách trả về toàn bộ, không phân trang.
 */
@Injectable()
export class DoctorFamiliesService {
  constructor(private readonly prisma: PrismaService) {}

  private familyWhere(actor: AuthenticatedUser): Prisma.FamilyUnitWhereInput {
    return { medicalContracts: { some: { doctor: { userId: actor.id } } } };
  }

  private contractArgs(actor: AuthenticatedUser) {
    return {
      ...latestContractSelect,
      where: { doctor: { userId: actor.id } },
    } satisfies Prisma.FamilyUnit$medicalContractsArgs;
  }

  async list(actor: AuthenticatedUser) {
    const rows = await this.prisma.familyUnit.findMany({
      where: this.familyWhere(actor),
      select: {
        id: true,
        homeAddress: true,
        status: true,
        representativeUser: { select: { fullName: true, phone: true } },
        _count: { select: { patients: { where: { status: 'ACTIVE' } } } },
        medicalContracts: this.contractArgs(actor),
      },
      orderBy: [{ representativeUser: { fullName: 'asc' } }, { id: 'asc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      representativeName: row.representativeUser.fullName,
      representativePhone: row.representativeUser.phone,
      homeAddress: row.homeAddress,
      familyStatus: row.status,
      memberCount: row._count.patients,
      contract: toContract(row.medicalContracts[0]),
    }));
  }

  async detail(actor: AuthenticatedUser, familyId: string) {
    const row = await this.prisma.familyUnit.findFirst({
      where: { id: familyId, ...this.familyWhere(actor) },
      select: {
        id: true,
        homeAddress: true,
        emergencyPhone: true,
        status: true,
        representativeUser: { select: { fullName: true, phone: true } },
        medicalContracts: this.contractArgs(actor),
        patients: {
          orderBy: [{ dateOfBirth: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            fullName: true,
            dateOfBirth: true,
            gender: true,
            relationshipToHead: true,
            bloodType: true,
            chronicDiseases: true,
            status: true,
          },
        },
      },
    });

    if (!row) {
      throw new ResourceNotFoundException(
        ContractErrorCode.FAMILY_UNIT_NOT_FOUND,
        'Không tìm thấy hộ gia đình.',
        'Hộ gia đình không tồn tại hoặc không có hợp đồng với bác sĩ.',
      );
    }

    return {
      id: row.id,
      representativeName: row.representativeUser.fullName,
      representativePhone: row.representativeUser.phone,
      homeAddress: row.homeAddress,
      emergencyPhone: row.emergencyPhone,
      familyStatus: row.status,
      contract: toContract(row.medicalContracts[0]),
      members: row.patients,
    };
  }
}
