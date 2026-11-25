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

export class PrismaEncountersSession implements EncountersSession {
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

  findFirstPatientOfFamily(familyId: string) {
    return this.tx.patient.findFirst({
      where: { familyId, status: 'ACTIVE' },
      select: { id: true, fullName: true },
    });
  }

  async ensureContractDefaultMembers(
    contractId: string,
    familyId: string,
    representativeFullName: string,
  ): Promise<EncounterDetail['contract']['members']> {
    let patients = await this.tx.patient.findMany({
      where: { familyId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });

    if (patients.length === 0) {
      const created = await this.tx.patient.create({
        data: {
          familyId,
          fullName: representativeFullName || 'Chủ hộ',
          relationshipToHead: 'SELF',
          dateOfBirth: new Date('1990-01-01'),
          gender: 'OTHER',
          status: 'ACTIVE',
        },
      });
      patients = [created];
    }

    const headPatient =
      patients.find((patient) => patient.relationshipToHead === 'SELF') ?? patients[0];

    await this.tx.contractMember.createMany({
      data: [{ contractId, patientId: headPatient.id }],
      skipDuplicates: true,
    });

    return this.tx.contractMember.findMany({
      where: { contractId },
      include: { patient: true },
    });
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
      const contract = await this.tx.medicalContract.findUnique({
        where: { id: contractId },
        include: { servicePackage: true },
      });
      const policy = contract?.servicePackage?.videoQuotaPolicy ?? 'FIXED';
      if (policy === 'UNLIMITED' || policy === 'CONTRACT') {
        return;
      }
      await this.tx.medicalContract.update({
        where: { id: contractId },
        data: { remainingTelehealth: { decrement: 1 } },
      });
    }
  }

  async holdTelehealthQuota(contractId: string) {
    await this.tx.medicalContract.update({
      where: { id: contractId },
      data: { heldTelehealth: { increment: 1 } },
    });
  }

  async releaseTelehealthQuota(contractId: string) {
    await this.tx.medicalContract.updateMany({
      where: { id: contractId, heldTelehealth: { gt: 0 } },
      data: { heldTelehealth: { decrement: 1 } },
    });
  }

  async commitHeldTelehealthQuota(contractId: string) {
    const contract = await this.tx.medicalContract.findUnique({
      where: { id: contractId },
      include: { servicePackage: true },
    });
    const policy = contract?.servicePackage?.videoQuotaPolicy ?? 'FIXED';
    if (policy === 'UNLIMITED' || policy === 'CONTRACT') {
      return;
    }
    const released = await this.tx.medicalContract.updateMany({
      where: { id: contractId, heldTelehealth: { gt: 0 } },
      data: {
        heldTelehealth: { decrement: 1 },
        remainingTelehealth: { decrement: 1 },
      },
    });
    if (released.count === 0) {
      await this.tx.medicalContract.updateMany({
        where: { id: contractId, remainingTelehealth: { gt: 0 } },
        data: { remainingTelehealth: { decrement: 1 } },
      });
    }
  }

  async refundTelehealthQuota(contractId: string) {
    const contract = await this.tx.medicalContract.findUnique({
      where: { id: contractId },
      include: { servicePackage: true },
    });
    const policy = contract?.servicePackage?.videoQuotaPolicy ?? 'FIXED';
    if (policy === 'UNLIMITED' || policy === 'CONTRACT') {
      return;
    }
    await this.tx.medicalContract.update({
      where: { id: contractId },
      data: { remainingTelehealth: { increment: 1 } },
    });
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
      include: {
        encounter: {
          select: {
            id: true,
            contractId: true,
            encounterType: true,
            category: true,
            visitScope: true,
            scheduledDate: true,
            scheduledTime: true,
            encounterStatus: true,
            doctor: { select: { id: true, doctorName: true } },
            participants: {
              include: { patient: { select: { id: true, fullName: true } } },
            },
            contract: {
              select: {
                id: true,
                contractNumber: true,
                familyUnit: {
                  select: {
                    id: true,
                    homeAddress: true,
                    representativeUser: { select: { id: true, fullName: true, phone: true } },
                  },
                },
              },
            },
          },
        },
      },
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
