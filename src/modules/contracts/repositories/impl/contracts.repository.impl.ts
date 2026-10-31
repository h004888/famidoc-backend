import { randomUUID } from 'node:crypto';
import type {
  TerminationRequest,
  CreateTerminationRequest,
  UpdateTerminationRequest,
} from '../../entities/contract-change.entity';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { activateAddendumRights } from '../../activation/activate-addendum';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/database/prisma.service';
import { serializable } from '../../../../core/database/prisma-transaction';
import {
  notifyContractParties,
  writeBusinessAudit,
} from '../../../../core/business/business-helpers';
import {
  CONTRACT_CHANGE_INCLUDE,
  CHANGE_ADDENDUM_INCLUDE,
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
class PrismaContractsSession implements ContractsSession {
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
          ? { terminationReason: reason, terminatedAt: new Date() }
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
  findContractSignatures(contractId: string) {
    return this.tx.contractSignature.findMany({
      where: { contractId, addendumId: null },
      orderBy: { signedAt: 'asc' },
    });
  }
  saveUpgradeSignature(data: Prisma.ContractSignatureUncheckedCreateInput) {
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
}
