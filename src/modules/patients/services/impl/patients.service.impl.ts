import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import type { CreatePatientDto } from '../../dtos/create-patient.dto';
import type { UpdatePatientDto } from '../../dtos/update-patient.dto';
import type { CreateAllergyDto } from '../../dtos/create-allergy.dto';
import type { CreatePatientDocumentDto } from '../../dtos/create-patient-document.dto';
import {
  PATIENTS_REPOSITORY_TOKEN,
  type IPatientsRepository,
  type PatientDetail,
} from '../../repositories/interfaces/patients.repository.interface';
import type { IPatientsService } from '../interfaces/patients.service.interface';
import type { Patient, PatientAllergy, PatientDocument } from '@prisma/client';

@Injectable()
export class PatientsServiceImpl implements IPatientsService {
  constructor(
    @Inject(PATIENTS_REPOSITORY_TOKEN)
    private readonly repository: IPatientsRepository,
  ) {}

  private async resolveFamilyId(
    user: AuthenticatedUser,
    familyIdFromDto?: string,
  ): Promise<string> {
    if (user.role === 'ADMIN') {
      if (!familyIdFromDto) {
        throw new BadRequestException('familyId is required for admin when creating patient');
      }
      return familyIdFromDto;
    }

    if (user.role === 'FAMILY_REP') {
      if (user.familyUnitId) {
        return user.familyUnitId;
      }
      const family = await this.repository.findFamilyUnitByRepresentativeUserId(user.id);
      if (!family) {
        throw new ForbiddenException('Family unit not found for representative');
      }
      return family.id;
    }

    throw new ForbiddenException('Only FAMILY_REP and ADMIN are allowed');
  }

  private async assertPatientAccess(
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<PatientDetail> {
    const patient = await this.repository.findById(patientId);
    if (!patient) {
      throw new NotFoundException(`Patient with ID ${patientId} not found`);
    }

    if (user.role === 'ADMIN') {
      return patient;
    }

    if (user.role === 'FAMILY_REP') {
      let repFamilyId = user.familyUnitId;
      if (!repFamilyId) {
        const family = await this.repository.findFamilyUnitByRepresentativeUserId(user.id);
        repFamilyId = family?.id ?? null;
      }

      if (patient.familyId !== repFamilyId) {
        throw new ForbiddenException('Access denied to patient profile');
      }

      return patient;
    }

    throw new ForbiddenException('Access denied');
  }

  async createPatient(user: AuthenticatedUser, dto: CreatePatientDto): Promise<Patient> {
    const familyId = await this.resolveFamilyId(user, dto.familyId);

    if (this.repository.createWithActiveContractLock) {
      return this.repository.createWithActiveContractLock(familyId, dto);
    }

    if (this.repository.findActiveContractByFamilyId) {
      const activeContract =
        await this.repository.findActiveContractByFamilyId(familyId);
      if (!activeContract) {
        throw new ForbiddenException(
          'Hộ gia đình cần đăng ký và kích hoạt gói dịch vụ (ACTIVE) trước khi thêm thành viên',
        );
      }

      if (this.repository.countPatientsByFamilyId) {
        const currentCount =
          await this.repository.countPatientsByFamilyId(familyId);
        if (currentCount >= activeContract.memberCount) {
          throw new BadRequestException(
            `Hộ gia đình đã đạt giới hạn tối đa ${activeContract.memberCount} thành viên của gói hiện tại. Vui lòng nâng cấp gói hoặc mua phụ lục bổ sung.`,
          );
        }
      }

      if (this.repository.createAndAttachToContract) {
        return this.repository.createAndAttachToContract(
          familyId,
          activeContract.id,
          dto,
        );
      }
    }

    return this.repository.create(familyId, dto);
  }

  async listFamilyMembers(user: AuthenticatedUser): Promise<Patient[]> {
    if (user.role === 'ADMIN') {
      return this.repository.findAll();
    }

    if (user.role === 'FAMILY_REP') {
      const familyId = await this.resolveFamilyId(user);
      return this.repository.findByFamilyId(familyId);
    }

    throw new ForbiddenException('Access denied');
  }

  async getPatientById(user: AuthenticatedUser, id: string): Promise<PatientDetail> {
    return this.assertPatientAccess(user, id);
  }

  async updatePatient(
    user: AuthenticatedUser,
    id: string,
    dto: UpdatePatientDto,
  ): Promise<Patient> {
    await this.assertPatientAccess(user, id);
    return this.repository.update(id, dto);
  }

  async detachPatient(user: AuthenticatedUser, id: string): Promise<Patient> {
    const patient = await this.assertPatientAccess(user, id);
    if ((patient.relationshipToHead || '').trim().toUpperCase() === 'SELF') {
      throw new BadRequestException(
        'Không thể tách chủ hộ khỏi sổ hộ tịch gia đình',
      );
    }
    if (patient.status === 'INACTIVE') {
      throw new BadRequestException(
        'Thành viên này đã được tách khỏi hộ gia đình',
      );
    }
    if (this.repository.softDeactivate) {
      return this.repository.softDeactivate(id);
    }
    return this.repository.update(id, { status: 'INACTIVE' });
  }

  async addAllergy(
    user: AuthenticatedUser,
    patientId: string,
    dto: CreateAllergyDto,
  ): Promise<PatientAllergy> {
    await this.assertPatientAccess(user, patientId);
    return this.repository.addAllergy(patientId, dto);
  }

  async listAllergies(
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<PatientAllergy[]> {
    await this.assertPatientAccess(user, patientId);
    return this.repository.findAllergiesByPatientId(patientId);
  }

  async addDocument(
    user: AuthenticatedUser,
    patientId: string,
    dto: CreatePatientDocumentDto,
  ): Promise<PatientDocument> {
    await this.assertPatientAccess(user, patientId);
    return this.repository.addDocument(patientId, dto);
  }

  async listDocuments(
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<PatientDocument[]> {
    await this.assertPatientAccess(user, patientId);
    return this.repository.findDocumentsByPatientId(patientId);
  }
}
