import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import type { CreatePeriodicEncounterDto } from '../../dtos/create-periodic-encounter.dto';
import type { CreateAdHocEncounterDto } from '../../dtos/create-adhoc-encounter.dto';
import type { FinalizeEncounterDto } from '../../dtos/finalize-encounter.dto';
import type { ConfirmEncounterDto } from '../../dtos/confirm-encounter.dto';
import type { RequestRescheduleDto } from '../../dtos/request-reschedule.dto';
import type { DecideRescheduleRequestDto } from '../../dtos/decide-reschedule-request.dto';
import type { ListEncountersQueryDto } from '../../dtos/list-encounters-query.dto';

export const ENCOUNTERS_SERVICE_TOKEN = Symbol('IEncountersService');

export interface IEncountersService {
  createPeriodicEncounter(actor: AuthenticatedUser, dto: CreatePeriodicEncounterDto): Promise<unknown>;
  createAdHocEncounter(actor: AuthenticatedUser, dto: CreateAdHocEncounterDto): Promise<unknown>;
  finalizeEncounter(actor: AuthenticatedUser, encounterId: string, dto: FinalizeEncounterDto): Promise<unknown>;
  confirmEncounter(actor: AuthenticatedUser, encounterId: string, dto: ConfirmEncounterDto): Promise<unknown>;
  markOnTheWay(actor: AuthenticatedUser, encounterId: string): Promise<unknown>;
  markArrived(actor: AuthenticatedUser, encounterId: string): Promise<unknown>;
  confirmArrival(actor: AuthenticatedUser, encounterId: string): Promise<unknown>;
  requestReschedule(actor: AuthenticatedUser, encounterId: string, dto: RequestRescheduleDto): Promise<unknown>;
  decideRescheduleRequest(
    actor: AuthenticatedUser,
    encounterId: string,
    requestId: string,
    dto: DecideRescheduleRequestDto,
  ): Promise<unknown>;
  getPendingRescheduleRequests(actor: AuthenticatedUser): Promise<unknown>;
  getDoctorTimetable(actor: AuthenticatedUser, query: ListEncountersQueryDto): Promise<unknown>;
  getFamilyTimetable(actor: AuthenticatedUser, query: ListEncountersQueryDto): Promise<unknown>;
  getFacilityScheduleBoard(actor: AuthenticatedUser, fromDate?: string, toDate?: string): Promise<unknown>;
  getEncounterDetail(actor: AuthenticatedUser, encounterId: string): Promise<unknown>;
  generateContractPeriodicCadence(
    contractId: string,
    options?: { triggeredBy?: string; force?: boolean },
  ): Promise<{ generatedCount: number; encounters: unknown[] }>;
  finalizeCadenceSchedule(actor: AuthenticatedUser, contractId: string): Promise<{ finalizedCount: number; encounters: unknown[] }>;
  confirmCadenceSchedule(actor: AuthenticatedUser, contractId: string): Promise<{ confirmedCount: number; encounters: unknown[] }>;
  adjustCadenceMilestone(
    actor: AuthenticatedUser,
    encounterId: string,
    dto: { scheduledDate?: string; scheduledTime?: string; encounterType?: string },
  ): Promise<unknown>;
  getDoctorMonthlyAvailability(
    actor: AuthenticatedUser,
    doctorId: string,
    month: string,
    contractId?: string,
    excludeEncounterId?: string,
  ): Promise<unknown>;
  withdrawRescheduleRequest(
    actor: AuthenticatedUser,
    encounterId: string,
    requestId: string,
  ): Promise<unknown>;
  doctorManualSchedule(
    actor: AuthenticatedUser,
    encounterId: string,
    dto: { proposedDate: string; slotWindow: 'MORNING' | 'AFTERNOON' },
  ): Promise<unknown>;
  retryContractAutoSchedule(
    actor: AuthenticatedUser,
    contractId: string,
  ): Promise<unknown>;
}
