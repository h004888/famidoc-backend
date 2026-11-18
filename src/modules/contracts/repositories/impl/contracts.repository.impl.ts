import { randomUUID } from 'node:crypto';
import type {
  TerminationRequest,
  CreateTerminationRequest,
  UpdateTerminationRequest,
} from '../../entities/contract-change.entity';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { activateAddendumRights } from '../../activation/activate-addendum';
import { Injectable } from '@nestjs/common';
import { Prisma, type B2bContractStatus } from '@prisma/client';
import { PrismaService } from '../../../../core/database/prisma.service';
import { serializable } from '../../../../core/database/prisma-transaction';
import {
  notifyContractParties,
  writeBusinessAudit,
} from '../../../../core/business/business-helpers';
import { buildActiveAndHeldWhere } from '../../pricing/doctor-quota.helper';
import {
  CONTRACT_CHANGE_INCLUDE,
  CHANGE_ADDENDUM_INCLUDE,
  MEDICAL_CONTRACT_DETAIL_INCLUDE,
  type IContractsRepository,
  type ContractsSession,
  type ChangeContract,
} from '../interfaces/contracts.repository.interface';
@Injectable()
export class ContractsRepositoryImpl implements IContractsRepository {
  constructor(private readonly prisma: PrismaService) {}
  transaction<T>(work: (session: ContractsSession) => Promise<T>) {
    return serializable(this.prisma, (tx) =>
      work(new PrismaContractsSession(tx)),
    );
  }
}
export class PrismaContractsSession implements ContractsSession {
  constructor(private readonly tx: Prisma.TransactionClient) {}
  async findContractForUpdate(id: string) {
    // Mọi thay đổi của cùng hợp đồng đi lần lượt, tránh hai phụ lục cùng tính theo dữ liệu cũ.
    await this.tx
      .$queryRaw`SELECT id FROM medical_contracts WHERE id=${id}::uuid FOR UPDATE`;
    return this.tx.medicalContract.findUnique({
      where: { id },
      include: CONTRACT_CHANGE_INCLUDE,
    });
  }
  findPackage(id: string) {
    return this.tx.servicePackage.findUnique({ where: { id } });
  }
  countFamilyMembers(familyId: string) {
    return this.tx.patient.count({ where: { familyId, status: 'ACTIVE' } });
  }
  async hasOtherActiveContract(familyId: string, exceptId: string) {
    return !!(await this.tx.medicalContract.findFirst({
      where: { familyId, id: { not: exceptId }, contractStatus: 'ACTIVE' },
      select: { id: true },
    }));
  }
  findOpenUpgrade(sourceId: string) {
    return this.tx.medicalContract.findFirst({
      where: {
        upgradedFromId: sourceId,
        contractStatus: {
          in: ['PENDING_APPROVAL', 'PENDING_PAYMENT', 'ACTIVE'],
        },
      },
      include: CONTRACT_CHANGE_INCLUDE,
    });
  }
  findAddendum(id: string) {
    return this.tx.contractAddendum.findUnique({
      where: { id },
      include: CHANGE_ADDENDUM_INCLUDE,
    });
  }
  findAddendumByKey(requestKey: string) {
    return this.tx.contractAddendum.findUnique({ where: { requestKey } });
  }
  async hasPendingMemberAddendum(contractId: string) {
    return !!(await this.tx.contractAddendum.findFirst({
      where: {
        contractId,
        addendumType: 'MEMBER_EXTENSION',
        status: 'PENDING_PAYMENT',
      },
      select: { id: true },
    }));
  }
  createAddendum(data: Prisma.ContractAddendumUncheckedCreateInput) {
    return this.tx.contractAddendum.create({ data });
  }
  async activateFreeAddendum(contractId: string, addendumId: string) {
    await activateAddendumRights(this.tx, contractId, addendumId);
  }
  saveAddendumSignature(data: Prisma.ContractSignatureUncheckedCreateInput) {
    return this.tx.contractSignature.create({ data });
  }
  createUpgrade(data: Prisma.MedicalContractUncheckedCreateInput) {
    return this.tx.medicalContract.create({
      data,
      include: CONTRACT_CHANGE_INCLUDE,
    });
  }
  async updateContractStatus(
    id: string,
    status: 'EXPIRED' | 'TERMINATED' | 'PENDING_PAYMENT',
    reason?: string,
  ) {
    await this.tx.medicalContract.update({
      where: { id },
      data: {
        contractStatus: status,
        ...(status === 'TERMINATED'
          ? {
              terminationReason: reason,
              terminatedAt: new Date(),
              holdExpiresAt: null,
            }
          : {}),
      },
    });
  }
  async refreshDoctorPanel(doctorId: string) {
    await this.tx
      .$queryRaw`SELECT id FROM doctors WHERE id=${doctorId}::uuid FOR UPDATE`;
    const count = await this.tx.medicalContract.count({
      where: { doctorId, contractStatus: 'ACTIVE' },
    });
    await this.tx.doctor.update({
      where: { id: doctorId },
      data: { activePanelCount: count },
    });
  }
  private async readTerminationRequests(
    contractId: string,
  ): Promise<TerminationRequest[]> {
    // Service đã khóa dòng hợp đồng trước khi gọi. Các yêu cầu cũ được giữ lại trong cùng danh sách.
    const contract = await this.tx.medicalContract.findUniqueOrThrow({
      where: { id: contractId },
      select: { terminationRequests: true },
    });
    return contract.terminationRequests as unknown as TerminationRequest[];
  }
  async findPendingTermination(contractId: string) {
    return (
      (await this.readTerminationRequests(contractId)).find(
        (r) => r.status === 'PENDING',
      ) ?? null
    );
  }
  async findTermination(contractId: string, id: string) {
    return (
      (await this.readTerminationRequests(contractId)).find(
        (r) => r.id === id,
      ) ?? null
    );
  }
  async createTermination(data: CreateTerminationRequest) {
    const requests = await this.readTerminationRequests(data.contractId);
    if (requests.some((r) => r.status === 'PENDING'))
      throw new ConflictException('A termination request is already pending');
    const item: TerminationRequest = {
      ...data,
      id: randomUUID(),
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      decisionNotes: null,
      decidedByUserId: null,
      decidedAt: null,
    };
    await this.tx.medicalContract.update({
      where: { id: data.contractId },
      data: {
        terminationRequests: [
          ...requests,
          item,
        ] as unknown as Prisma.InputJsonValue,
      },
    });
    return item;
  }
  async updateTermination(
    contractId: string,
    id: string,
    data: UpdateTerminationRequest,
  ) {
    const requests = await this.readTerminationRequests(contractId);
    const index = requests.findIndex((r) => r.id === id);
    if (index < 0) throw new NotFoundException('Termination request not found');
    requests[index] = { ...requests[index], ...data };
    await this.tx.medicalContract.update({
      where: { id: contractId },
      data: {
        terminationRequests: requests as unknown as Prisma.InputJsonValue,
      },
    });
    return requests[index];
  }
  async hasEncounterInProgress(contractId: string) {
    return !!(await this.tx.encounter.findFirst({
      where: { contractId, encounterStatus: 'IN_PROGRESS' },
      select: { id: true },
    }));
  }
  async cancelUnpaidRights(contractId: string) {
    // Chỉ đóng mã chưa trả tiền và quyền chưa thực hiện. Không đụng hóa đơn PAID hay bệnh án.
    await this.tx.invoice.updateMany({
      where: { contractId, paymentStatus: 'PENDING' },
      data: { paymentStatus: 'CANCELLED' },
    });
    await this.tx.contractAddendum.updateMany({
      where: { contractId, status: 'PENDING_PAYMENT' },
      data: { status: 'CANCELLED' },
    });
    await this.tx.encounter.updateMany({
      where: {
        contractId,
        encounterStatus: { in: ['REQUESTED', 'CONFIRMED'] },
      },
      data: {
        encounterStatus: 'CANCELLED',
        cancelReason: 'Contract terminated by approved agreement',
      },
    });
  }
  async hasPaidInvoice(contractId: string) {
    return !!(await this.tx.invoice.findFirst({
      where: { contractId, paymentStatus: 'PAID' },
      select: { id: true },
    }));
  }
  async cancelPendingInvoices(contractId: string) {
    // Hủy yêu cầu thanh toán VietQR còn chờ của bản nháp; không đụng hóa đơn đã PAID.
    await this.tx.invoice.updateMany({
      where: { contractId, paymentStatus: 'PENDING' },
      data: { paymentStatus: 'CANCELLED' },
    });
  }
  findContractSignatures(contractId: string) {
    return this.tx.contractSignature.findMany({
      where: { contractId, addendumId: null },
      orderBy: { signedAt: 'asc' },
    });
  }
  saveUpgradeSignature(data: Prisma.ContractSignatureUncheckedCreateInput) {
    return this.tx.contractSignature.create({ data });
  }
  saveSignature(data: Prisma.ContractSignatureUncheckedCreateInput) {
    return this.tx.contractSignature.create({ data });
  }
  async recordChange(
    actorId: string,
    contract: ChangeContract,
    action: string,
    resourceId: string,
  ) {
    await writeBusinessAudit(
      this.tx,
      actorId,
      action,
      'medical_contracts',
      resourceId,
    );
    await notifyContractParties(
      this.tx,
      contract,
      'Cập nhật hợp đồng',
      'Hợp đồng hoặc phụ lục có cập nhật. Vui lòng mở hồ sơ để xem điều khoản.',
      'CONTRACT',
    );
  }

  findFacilityById(id: string) {
    return this.tx.healthcareFacility.findUnique({
      where: { id },
      include: { user: true },
    });
  }

  findFacilityByUserId(userId: string) {
    return this.tx.healthcareFacility.findUnique({
      where: { userId },
      include: { user: true },
    });
  }

  findDoctorById(id: string) {
    return this.tx.doctor.findUnique({
      where: { id },
      include: {
        user: true,
        credentials: {
          where: { credentialType: 'PRACTICE_LICENSE_CCHN' },
          orderBy: { issueDate: 'desc' },
        },
      },
    });
  }

  async lockDoctorAndCountActiveAndHeld(
    doctorId: string,
    exceptContractId?: string,
  ) {
    await this.tx
      .$queryRaw`SELECT id FROM doctors WHERE id=${doctorId}::uuid FOR UPDATE`;
    const doctor = await this.findDoctorById(doctorId);
    if (!doctor) return null;
    const activeAndHeldCount = await this.tx.medicalContract.count({
      where: buildActiveAndHeldWhere(doctorId, {
        now: new Date(),
        exceptContractId,
      }),
    });
    return { doctor, activeAndHeldCount };
  }

  findMatchingSessionById(id: string) {
    return this.tx.matchingSession.findUnique({
      where: { id },
    });
  }

  async markMatchingSessionConfirmed(id: string, contractId: string) {
    await this.tx.matchingSession.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        contractId,
      },
    });
  }

  findMatchingQueueRequestById(id: string) {
    return this.tx.matchingQueueRequest.findUnique({
      where: { id },
    });
  }

  async markMatchingQueueConfirmed(id: string, contractId: string) {
    await this.tx.matchingQueueRequest.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        contractId,
      },
    });
  }

  findDoctorByUserId(userId: string) {
    return this.tx.doctor.findUnique({
      where: { userId },
      include: {
        user: true,
        credentials: {
          where: { credentialType: 'PRACTICE_LICENSE_CCHN' },
          orderBy: { issueDate: 'desc' },
        },
      },
    });
  }

  findFamilyById(id: string) {
    return this.tx.familyUnit.findUnique({
      where: { id },
      include: { representativeUser: true },
    });
  }

  findFamilyByRepresentativeUserId(userId: string) {
    return this.tx.familyUnit.findUnique({
      where: { representativeUserId: userId },
      include: { representativeUser: true },
    });
  }

  async findFirstActiveAdminUser() {
    // Ưu tiên tài khoản ADMIN thật (ACTIVE, không phải demo / email .invalid) để tránh lấy nhầm dữ liệu seed
    const realAdmin = await this.tx.user.findFirst({
      where: {
        role: 'ADMIN',
        status: 'ACTIVE',
        NOT: [{ email: { endsWith: '.invalid' } }, { fullName: { startsWith: 'DEMO' } }],
      },
      select: { id: true, email: true, fullName: true },
      orderBy: { createdAt: 'asc' },
    });
    if (realAdmin) {
      return realAdmin;
    }
    // Fallback: môi trường seed dev/staging chỉ có tài khoản demo — vẫn trả về admin đầu tiên
    // (việc chặn hay cho phép dữ liệu demo do guard strict-mode quyết định).
    return this.tx.user.findFirst({
      where: { role: 'ADMIN' },
      select: { id: true, email: true, fullName: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async saveDocumensoSigners(
    signers: Array<{
      contractId: string;
      signerRole: any;
      documensoRecipientId: number;
      documensoToken: string;
      documensoSigningUrl: string;
      status: string;
      completedAt?: Date | null;
    }>,
  ) {
    if (!signers.length) return;
    await this.tx.contractDocumensoSigner.createMany({
      data: signers,
      skipDuplicates: true,
    });
  }

  findDocumensoSigners(contractId: string) {
    return this.tx.contractDocumensoSigner.findMany({
      where: { contractId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateContractDocumensoEnvelope(
    contractId: string,
    documensoEnvelopeId: string,
    documensoItemId: string,
  ): Promise<boolean> {
    const res = await this.tx.medicalContract.updateMany({
      where: {
        id: contractId,
        documensoEnvelopeId: null,
        contractStatus: 'PENDING_APPROVAL',
        isDemo: false,
      },
      data: { documensoEnvelopeId, documensoItemId },
    });
    return res.count > 0;
  }

  async clearLegacyNonDocumensoSignatures(contractId: string) {
    await this.tx.contractSignature.deleteMany({
      where: {
        contractId,
        addendumId: null,
        documensoRecipientId: null,
      },
    });
  }

  async findFamilyGateStatus(familyId: string) {
    const [activeContractRow, pendingContract, familyUnitRow, patientCount] = await Promise.all([
      this.tx.medicalContract.findFirst({
        where: { familyId, contractStatus: 'ACTIVE' },
        select: {
          id: true,
          contractNumber: true,
          memberCount: true,
          endDate: true,
          servicePackage: {
            select: {
              packageName: true,
              description: true,
            },
          },
          facility: {
            select: {
              facilityName: true,
              hotline: true,
            },
          },
          doctor: {
            select: {
              id: true,
              doctorName: true,
              academicTitle: true,
              specialty: true,
              experienceYears: true,
              user: {
                select: {
                  avatarUrl: true,
                  phone: true,
                },
              },
              facility: {
                select: {
                  facilityName: true,
                  hotline: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.tx.medicalContract.findFirst({
        where: {
          familyId,
          contractStatus: { in: ['PENDING_APPROVAL', 'PENDING_PAYMENT'] },
        },
        select: {
          id: true,
          contractNumber: true,
          contractStatus: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.tx.familyUnit.findUnique({
        where: { id: familyId },
        select: {
          id: true,
          homeAddress: true,
          emergencyPhone: true,
          representativeUser: {
            select: {
              fullName: true,
            },
          },
        },
      }),
      this.tx.patient.count({ where: { familyId, status: 'ACTIVE' } }),
    ]);

    const activeContract = activeContractRow
      ? {
          id: activeContractRow.id,
          contractNumber: activeContractRow.contractNumber,
          memberCount: activeContractRow.memberCount,
          endDate: activeContractRow.endDate,
          packageName: activeContractRow.servicePackage?.packageName ?? null,
          packageDescription: activeContractRow.servicePackage?.description ?? null,
          doctor: activeContractRow.doctor
            ? {
                id: activeContractRow.doctor.id,
                fullName: activeContractRow.doctor.doctorName,
                title:
                  activeContractRow.doctor.academicTitle?.trim() ||
                  activeContractRow.doctor.specialty ||
                  'Bác sĩ Gia đình phụ trách hộ',
                hospitalName:
                  activeContractRow.doctor.facility?.facilityName ||
                  activeContractRow.facility?.facilityName ||
                  'Cơ sở y tế liên kết FamiDoc',
                avatarUrl: activeContractRow.doctor.user?.avatarUrl ?? null,
                phone:
                  activeContractRow.doctor.user?.phone ||
                  activeContractRow.doctor.facility?.hotline ||
                  activeContractRow.facility?.hotline ||
                  null,
                experienceYears: activeContractRow.doctor.experienceYears,
              }
            : null,
        }
      : null;

    const familyUnit = familyUnitRow
      ? {
          id: familyUnitRow.id,
          homeAddress: familyUnitRow.homeAddress,
          emergencyPhone: familyUnitRow.emergencyPhone,
          representativeName:
            familyUnitRow.representativeUser?.fullName ?? 'Đại diện hộ gia đình',
        }
      : null;

    return { activeContract, pendingContract, familyUnit, patientCount };
  }

  findPatientsByIdsAndFamilyId(patientIds: string[], familyId: string) {
    return this.tx.patient.findMany({
      where: { id: { in: patientIds }, familyId },
      select: { id: true },
    });
  }

  createMedicalContract(data: Prisma.MedicalContractUncheckedCreateInput) {
    return this.tx.medicalContract.create({
      data,
      include: CONTRACT_CHANGE_INCLUDE,
    });
  }

  async createContractMembers(contractId: string, patientIds: string[]) {
    await this.tx.contractMember.createMany({
      data: patientIds.map((patientId) => ({ contractId, patientId })),
    });
  }

  updateContractDoctor(id: string, doctorId: string) {
    return this.tx.medicalContract.update({
      where: { id },
      data: { doctorId },
      include: CONTRACT_CHANGE_INCLUDE,
    });
  }

  async listMedicalContracts(
    where: Prisma.MedicalContractWhereInput,
    skip: number,
    take: number,
  ) {
    const [total, items] = await Promise.all([
      this.tx.medicalContract.count({ where }),
      this.tx.medicalContract.findMany({
        where,
        skip,
        take,
        include: MEDICAL_CONTRACT_DETAIL_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { items, total };
  }

  findMedicalContractById(id: string) {
    return this.tx.medicalContract.findUnique({
      where: { id },
      include: MEDICAL_CONTRACT_DETAIL_INCLUDE,
    });
  }

  findPatientsWithClinicalProfile(patientIds: string[]) {
    return this.tx.patient.findMany({
      where: { id: { in: patientIds } },
      include: {
        allergies: true,
        documents: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  findActiveStaffingContract(facilityId: string, atDate: Date) {
    return this.tx.b2bStaffingContract.findFirst({
      where: {
        facilityId,
        status: 'ACTIVE',
        startDate: { lte: atDate },
        endDate: { gt: atDate },
      },
    });
  }

  findConflictingStaffingContract(
    facilityId: string,
    startDate: Date,
    endDate: Date,
    excludeContractId?: string,
  ) {
    return this.tx.b2bStaffingContract.findFirst({
      where: {
        facilityId,
        ...(excludeContractId ? { id: { not: excludeContractId } } : {}),
        status: {
          in: [
            'ACTIVE',
            'PENDING_FACILITY_SIGNATURE',
            'REVISION_REQUESTED',
            'PENDING_ADMIN_SIGNATURE',
          ],
        },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
  }

  createStaffingContract(data: Prisma.B2bStaffingContractUncheckedCreateInput) {
    return this.tx.b2bStaffingContract.create({
      data,
      include: { facility: { include: { user: true } } },
    });
  }

  findStaffingContract(id: string) {
    return this.tx.b2bStaffingContract.findUnique({
      where: { id },
      include: { facility: { include: { user: true } } },
    });
  }

  async lockStaffingContractForUpdate(id: string) {
    await this.tx
      .$queryRaw`SELECT id FROM b2b_staffing_contracts WHERE id = ${id}::uuid FOR UPDATE`;
    return this.findStaffingContract(id);
  }

  updateStaffingContract(
    id: string,
    data: Prisma.B2bStaffingContractUncheckedUpdateInput,
  ) {
    return this.tx.b2bStaffingContract.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
      include: { facility: { include: { user: true } } },
    });
  }

  updateStaffingContractStatus(
    id: string,
    status: B2bContractStatus,
    signedPdfUrl?: string,
  ) {
    return this.tx.b2bStaffingContract.update({
      where: { id },
      data: {
        status,
        ...(signedPdfUrl ? { signedPdfUrl } : {}),
        updatedAt: new Date(),
      },
      include: { facility: { include: { user: true } } },
    });
  }

  async getStaffingTerminationImpact(facilityId: string) {
    const [
      activeMedicalContracts,
      pendingMedicalContracts,
      openEncounters,
      unsettledSettlements,
      unsettledPaidInvoices,
      activeOrOnboardingDoctors,
      openComplaints,
    ] = await Promise.all([
      this.tx.medicalContract.count({
        where: { facilityId, contractStatus: 'ACTIVE' },
      }),
      this.tx.medicalContract.count({
        where: {
          facilityId,
          contractStatus: { in: ['PENDING_APPROVAL', 'PENDING_PAYMENT'] },
        },
      }),
      this.tx.encounter.count({
        where: {
          contract: { facilityId },
          encounterStatus: { in: ['REQUESTED', 'CONFIRMED', 'IN_PROGRESS'] },
        },
      }),
      this.tx.facilitySettlement.count({
        where: {
          facilityId,
          disbursementStatus: { in: ['PENDING', 'CONFIRMED', 'FAILED'] },
        },
      }),
      this.tx.invoice.count({
        where: {
          paymentStatus: 'PAID',
          contract: { facilityId },
          settlementItems: {
            none: {
              settlement: { disbursementStatus: 'SETTLED' },
            },
          },
        },
      }),
      this.tx.doctor.count({
        where: {
          facilityId,
          onboardingStatus: {
            in: [
              'PENDING_SUBMISSION',
              'PENDING_FACILITY_REVIEW',
              'FACILITY_VERIFIED',
              'ACTIVE',
            ],
          },
        },
      }),
      this.tx.complaint.count({
        where: {
          contract: { facilityId },
          status: { in: ['SUBMITTED', 'INVESTIGATING'] },
        },
      }),
    ]);

    return {
      activeMedicalContracts,
      pendingMedicalContracts,
      openEncounters,
      unsettledSettlements,
      unsettledPaidInvoices,
      activeOrOnboardingDoctors,
      openComplaints,
    };
  }

  async listStaffingContracts(
    where: Prisma.B2bStaffingContractWhereInput,
    skip: number,
    take: number,
  ) {
    const [total, items] = await Promise.all([
      this.tx.b2bStaffingContract.count({ where }),
      this.tx.b2bStaffingContract.findMany({
        where,
        skip,
        take,
        include: { facility: { include: { user: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { items, total };
  }

  async recordStaffingAudit(
    actorId: string,
    action: string,
    resourceId: string,
    ip: string,
  ) {
    await this.tx.auditLog.create({
      data: {
        actorUserId: actorId,
        action,
        resourceName: 'B2bStaffingContract',
        resourceId,
        clientIp: ip || '127.0.0.1',
        timestamp: new Date(),
      },
    });
  }

  async findAdminUsers(): Promise<{ id: string }[]> {
    return this.tx.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
  }

  async createNotification(data: {
    userId: string;
    title: string;
    content: string;
    type: string;
  }): Promise<void> {
    await this.tx.notification.create({ data });
  }
}
