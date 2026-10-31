import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/database/prisma.service';
import { serializable } from '../../../../core/database/prisma-transaction';
import {
  notifyContractParties,
  writeBusinessAudit,
} from '../../../../core/business/business-helpers';
import {
  COMPLAINT_CONTRACT_INCLUDE,
  COMPLAINT_INCLUDE,
  type IComplaintsRepository,
  type ComplaintsSession,
  type ComplaintContract,
} from '../interfaces/complaints.repository.interface';
@Injectable()
export class ComplaintsRepositoryImpl implements IComplaintsRepository {
  constructor(private readonly prisma: PrismaService) {}
  transaction<T>(work: (session: ComplaintsSession) => Promise<T>) {
    return serializable(this.prisma, (tx) =>
      work(new PrismaComplaintsSession(tx)),
    );
  }
}
class PrismaComplaintsSession implements ComplaintsSession {
  constructor(private readonly tx: Prisma.TransactionClient) {}
  findContract(id: string) {
    return this.tx.medicalContract.findUnique({
      where: { id },
      include: COMPLAINT_CONTRACT_INCLUDE,
    });
  }
  async encounterBelongsToContract(encounterId: string, contractId: string) {
    return !!(await this.tx.encounter.findFirst({
      where: { id: encounterId, contractId },
      select: { id: true },
    }));
  }
  createComplaint(data: Prisma.ComplaintUncheckedCreateInput) {
    return this.tx.complaint.create({ data });
  }
  findComplaint(id: string) {
    return this.tx.complaint.findUnique({
      where: { id },
      include: COMPLAINT_INCLUDE,
    });
  }
  updateComplaint(id: string, data: Prisma.ComplaintUncheckedUpdateInput) {
    return this.tx.complaint.update({ where: { id }, data });
  }
  async recordComplaintEvent(
    actorId: string,
    complaintId: string,
    action: string,
    contract: ComplaintContract,
  ) {
    await writeBusinessAudit(
      this.tx,
      actorId,
      action,
      'complaints',
      complaintId,
    );
    await notifyContractParties(
      this.tx,
      contract,
      'Cập nhật phản ánh dịch vụ',
      'Phản ánh dịch vụ có cập nhật mới. Mở chi tiết để xem phần được phân quyền.',
      'COMPLAINT',
    );
    const admins = await this.tx.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    await this.tx.notification.createMany({
      data: admins.map((a) => ({
        userId: a.id,
        title: 'Cập nhật phản ánh dịch vụ',
        content: 'Có phản ánh dịch vụ cần theo dõi.',
        type: 'COMPLAINT',
        referenceId: complaintId,
      })),
    });
  }
}
