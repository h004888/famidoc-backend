import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import type { CreatePeriodicEncounterDto } from '../../dtos/create-periodic-encounter.dto';
import type { CreateAdHocEncounterDto } from '../../dtos/create-adhoc-encounter.dto';
import type { FinalizeEncounterDto } from '../../dtos/finalize-encounter.dto';
import type { ConfirmEncounterDto } from '../../dtos/confirm-encounter.dto';
import type { RequestRescheduleDto } from '../../dtos/request-reschedule.dto';
import type { DoctorRescheduleReviewDto } from '../../dtos/doctor-reschedule-review.dto';
import type { CreateDoctorShiftDto } from '../../dtos/create-doctor-shift.dto';
import type { ListEncountersQueryDto } from '../../dtos/list-encounters-query.dto';

export const ENCOUNTERS_SERVICE_TOKEN = Symbol('IEncountersService');

export interface IEncountersService {
  createPeriodicEncounter(actor: AuthenticatedUser, dto: CreatePeriodicEncounterDto): Promise<unknown>;
  createAdHocEncounter(actor: AuthenticatedUser, dto: CreateAdHocEncounterDto): Promise<unknown>;
  finalizeEncounter(actor: AuthenticatedUser, encounterId: string, dto: FinalizeEncounterDto): Promise<unknown>;
  confirmEncounter(actor: AuthenticatedUser, encounterId: string, dto: ConfirmEncounterDto): Promise<unknown>;
  requestReschedule(actor: AuthenticatedUser, encounterId: string, dto: RequestRescheduleDto): Promise<unknown>;
  reviewReschedule(actor: AuthenticatedUser, encounterId: string, dto: DoctorRescheduleReviewDto): Promise<unknown>;
  createDoctorShift(actor: AuthenticatedUser, dto: CreateDoctorShiftDto): Promise<unknown>;
  getDoctorTimetable(actor: AuthenticatedUser, query: ListEncountersQueryDto): Promise<unknown>;
  getFamilyTimetable(actor: AuthenticatedUser, query: ListEncountersQueryDto): Promise<unknown>;
  getFacilityScheduleBoard(actor: AuthenticatedUser, fromDate?: string, toDate?: string): Promise<unknown>;
  getEncounterDetail(actor: AuthenticatedUser, encounterId: string): Promise<unknown>;
  generateContractPeriodicCadence(
    contractId: string,
    options?: { triggeredBy?: string; force?: boolean },
  ): Promise<{ generatedCount: number; encounters: unknown[] }>;
  finalizeCadenceSchedule(actor: AuthenticatedUser, contractId: string): Promise<{ finalizedCount: number; encounters: unknown[] }>;
  adjustCadenceMilestone(
    actor: AuthenticatedUser,
    encounterId: string,
    dto: { scheduledDate?: string; scheduledTime?: string; encounterType?: string },
  ): Promise<unknown>;
}
