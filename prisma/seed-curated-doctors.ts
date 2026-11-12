import { PrismaClient, UserRole, UserStatus, FacilityVerificationStatus, DoctorOnboardingStatus, DoctorCredentialType } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { hash } from 'bcryptjs';
import type { NormalizedDatasetResult } from '../scripts/etl-doctor-dataset';

const prisma = new PrismaClient();

export async function seedCuratedDoctors() {
  console.log('--- KHỞI TẠO NẠP DỮ LIỆU BÁC SĨ CHUẨN HÓA VÀO CƠ SỞ DỮ LIỆU FAMIDOC ---');

  const dataPath = path.resolve(__dirname, '../data/normalized/curated-doctors.json');
  if (!fs.existsSync(dataPath)) {
    throw new Error(`Không tìm thấy file dữ liệu chuẩn hóa tại: ${dataPath}. Vui lòng chạy etl-doctor-dataset.ts trước.`);
  }

  const raw = fs.readFileSync(dataPath, 'utf-8');
  const dataset: NormalizedDatasetResult = JSON.parse(raw);
  const defaultPasswordHash = await hash('FamidocDoctor@2026', 10);

  console.log(`Tìm thấy: ${dataset.facilities.length} Cơ sở y tế & ${dataset.doctors.length} Bác sĩ chuẩn hóa.`);

  await prisma.$transaction(
    async (tx) => {
    // 1. Upsert Cơ sở Y tế và User quản lý cơ sở
    for (const fac of dataset.facilities) {
      await tx.user.upsert({
        where: { email: fac.user.email },
        update: {
          fullName: fac.user.fullName,
          phone: fac.user.phone,
          status: UserStatus.ACTIVE,
        },
        create: {
          id: fac.user.id,
          email: fac.user.email,
          phone: fac.user.phone,
          fullName: fac.user.fullName,
          passwordHash: defaultPasswordHash,
          role: UserRole.HEALTHCARE_FACILITY,
          status: UserStatus.ACTIVE,
        },
      });

      await tx.healthcareFacility.upsert({
        where: { licenseNumber: fac.licenseNumber },
        update: {
          facilityName: fac.facilityName,
          address: fac.address,
          hotline: fac.hotline,
          taxCode: fac.taxCode,
          verificationStatus: FacilityVerificationStatus.ACTIVE,
        },
        create: {
          id: fac.id,
          userId: fac.userId,
          facilityName: fac.facilityName,
          licenseNumber: fac.licenseNumber,
          taxCode: fac.taxCode,
          address: fac.address,
          hotline: fac.hotline,
          bankName: fac.bankName,
          bankAccountNumber: fac.bankAccountNumber,
          bankAccountHolder: fac.bankAccountHolder,
          verificationStatus: FacilityVerificationStatus.ACTIVE,
        },
      });
    }
    console.log(`✓ Đã nạp thành công ${dataset.facilities.length} Cơ sở Y tế đối tác.`);

    // 2. Upsert Bác sĩ và Tài khoản User
    for (const doc of dataset.doctors) {
      await tx.user.upsert({
        where: { email: doc.user.email },
        update: {
          fullName: doc.user.fullName,
          phone: doc.user.phone,
          avatarUrl: doc.user.avatarUrl,
          status: UserStatus.ACTIVE,
        },
        create: {
          id: doc.user.id,
          email: doc.user.email,
          phone: doc.user.phone,
          fullName: doc.user.fullName,
          avatarUrl: doc.user.avatarUrl,
          passwordHash: defaultPasswordHash,
          role: UserRole.DOCTOR,
          status: UserStatus.ACTIVE,
        },
      });

      const upsertedDoctor = await tx.doctor.upsert({
        where: { userId: doc.userId },
        update: {
          doctorName: doc.doctorName,
          specialty: doc.specialty,
          academicTitle: doc.academicTitle,
          experienceYears: doc.experienceYears,
          bio: doc.bio,
          ratingAvg: doc.ratingAvg,
          totalReviews: doc.totalReviews,
          activePanelCount: doc.activePanelCount,
          maxPanelCapacity: doc.maxPanelCapacity,
          onboardingStatus: DoctorOnboardingStatus.ACTIVE,
          facilityId: doc.facilityId,
        },
        create: {
          id: doc.id,
          userId: doc.userId,
          facilityId: doc.facilityId,
          doctorName: doc.doctorName,
          specialty: doc.specialty,
          academicTitle: doc.academicTitle,
          experienceYears: doc.experienceYears,
          bio: doc.bio,
          ratingAvg: doc.ratingAvg,
          totalReviews: doc.totalReviews,
          activePanelCount: doc.activePanelCount,
          maxPanelCapacity: doc.maxPanelCapacity,
          onboardingStatus: DoctorOnboardingStatus.ACTIVE,
        },
      });

      // Upsert Chứng chỉ hành nghề
      const existingCred = await tx.doctorCredential.findFirst({
        where: { doctorId: upsertedDoctor.id, credentialType: DoctorCredentialType.PRACTICE_LICENSE_CCHN },
      });

      if (!existingCred) {
        await tx.doctorCredential.create({
          data: {
            id: doc.credential.id,
            doctorId: upsertedDoctor.id,
            credentialType: DoctorCredentialType.PRACTICE_LICENSE_CCHN,
            certificateNumber: doc.credential.certificateNumber,
            issueDate: new Date(doc.credential.issueDate),
            issuingAuthority: doc.credential.issuingAuthority,
            fileUrl: doc.credential.fileUrl,
            facilityVerified: true,
            platformApproved: true,
          },
        });
      }
    }
    console.log(`✓ Đã nạp thành công ${dataset.doctors.length} Bác sĩ chuyên khoa FamiDoc.`);
  }, { maxWait: 30000, timeout: 120000 });

  console.log('=== HOÀN TẤT NẠP DỮ LIỆU BÁC SĨ THÀNH CÔNG ===');
}

if (require.main === module) {
  seedCuratedDoctors()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
