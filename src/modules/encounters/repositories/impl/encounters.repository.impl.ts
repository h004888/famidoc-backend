import { Injectable } from '@nestjs/common';
import { Encounter, EncounterStatus, EncounterType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/database/prisma.service';
import { serializable } from '../../../../core/database/prisma-transaction';
import { writeBusinessAudit } from '../../../../core/business/business-helpers';
import {
  ENCOUNTER_INCLUDE,
  type EncounterDetail,
  type EncountersSession,
  type IEncountersRepository,
} from '../interfaces/encounters.repository.interface';

@Injectable()
export class EncountersRepositoryImpl implements IEncountersRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(work: (session: EncountersSession) => Promise<T>): Promise<T> {
    return serializable(this.prisma, (tx) => work(new PrismaEncountersSession(tx)));
  }
}

class PrismaEncountersSession implements EncountersSession {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  findContract(id: string) {
    return this.tx.medicalContract.findUnique({
      where: { id },
      include: {
        familyUnit: { include: { representativeUser: true } },
        facility: { include: { user: true } },
        doctor: { include: { user: true } },
        members: { include: { patient: true } },
        servicePackage: true,
      },
    });
  }

  async isPatientInContract(patientId: string, contractId: string) {
    const member = await this.tx.contractMember.findUnique({
      where: {
        contractId_patientId: { contractId, patientId },
      },
      select: { id: true },
    });
    return Boolean(member);
  }

  findDoctorByUserId(userId: string) {
    return this.tx.doctor.findUnique({
      where: { userId },
      include: { facility: true },
    });
  }

  findDoctorById(id: string) {
    return this.tx.doctor.findUnique({
      where: { id },
      include: { facility: true },
    });
  }

  findFacilityByUserId(userId: string) {
    return this.tx.healthcareFacility.findUnique({
      where: { userId },
    });
  }

  createEncounter(data: Prisma.EncounterUncheckedCreateInput) {
    return this.tx.encounter.create({ data });
  }

  findEncounter(id: string): Promise<EncounterDetail | null> {
    return this.tx.encounter.findUnique({
      where: { id },
      include: ENCOUNTER_INCLUDE,
    });
  }

  updateEncounter(id: string, data: Prisma.EncounterUncheckedUpdateInput) {
    return this.tx.encounter.update({
      where: { id },
      data,
    });
  }

  async decrementContractQuota(contractId: string, type: EncounterType) {
    if (type === 'HOME_VISIT') {
      await this.tx.medicalContract.update({
        where: { id: contractId },
        data: { remainingHomeVisits: { decrement: 1 } },
      });
    } else if (type === 'TELEHEALTH') {
      await this.tx.medicalContract.update({
        where: { id: contractId },
        data: { remainingTelehealth: { decrement: 1 } },
      });
    }
  }

  findDoctorOverlappingEncounters(
    doctorId: string,
    scheduledDate: Date,
    excludeEncounterId?: string,
    statuses: EncounterStatus[] = ['CONFIRMED'],
  ) {
    return this.tx.encounter.findMany({
      where: {
        doctorId,
        scheduledDate,
        encounterStatus: { in: statuses },
        ...(excludeEncounterId ? { id: { not: excludeEncounterId } } : {}),
      },
    });
  }

  findPendingRescheduleRequestByEncounter(encounterId: string) {
    return this.tx.encounterRescheduleRequest.findFirst({
      where: { encounterId, status: 'PENDING' },
    });
  }

  findRescheduleRequestById(requestId: string) {
    return this.tx.encounterRescheduleRequest.findUnique({
      where: { id: requestId },
    });
  }

  createRescheduleRequest(data: Prisma.EncounterRescheduleRequestUncheckedCreateInput) {
    return this.tx.encounterRescheduleRequest.create({ data });
  }

  updateRescheduleRequest(id: string, data: Prisma.EncounterRescheduleRequestUncheckedUpdateInput) {
    return this.tx.encounterRescheduleRequest.update({ where: { id }, data });
  }

  findPendingRescheduleRequests(where: Prisma.EncounterRescheduleRequestWhereInput) {
    return this.tx.encounterRescheduleRequest.findMany({
      where: { ...where, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findEncounters(
    where: Prisma.EncounterWhereInput,
    skip = 0,
    take = 20,
  ): Promise<[EncounterDetail[], number]> {
    const [items, total] = await Promise.all([
      this.tx.encounter.findMany({
        where,
        skip,
        take,
        include: ENCOUNTER_INCLUDE,
        orderBy: [{ scheduledDate: 'asc' }, { scheduledTime: 'asc' }],
      }),
      this.tx.encounter.count({ where }),
    ]);
    return [items, total];
  }

  async createNotification(data: Prisma.NotificationUncheckedCreateInput) {
    await this.tx.notification.create({ data });
  }

  async createNotifications(data: Prisma.NotificationUncheckedCreateInput[]) {
    if (data.length === 0) return;
    await this.tx.notification.createMany({ data });
  }

  async createAuditLog(actorId: string, action: string, resourceId: string) {
    await writeBusinessAudit(this.tx, actorId, action, 'Encounter', resourceId);
  }
}
