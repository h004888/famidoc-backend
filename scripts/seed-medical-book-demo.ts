import 'reflect-metadata';
import { Prisma, PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { todayInVietnam } from '../src/core/business/business-helpers';
import type { PrismaService } from '../src/core/database/prisma.service';
import { CarePackagesRepositoryImpl } from '../src/modules/care-packages/repositories/impl/care-packages.repository.impl';
import { calculateCarePackageQuote } from '../src/modules/care-packages/pricing/calculate-care-package-quote';
import { addContractMonths } from '../src/modules/payments/activation/contract-activation';

const id = (group: number, index = 1) =>
  `b020${group.toString(16).padStart(4, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`;
const doctorEmail = 'doctor.books@demo.famidoc.invalid';
const requestedDoctorEmail =
  process.env.BOOKS_DEMO_DOCTOR_EMAIL || 'doctor@demo.famidoc.invalid';
const families = [
  { name: 'Nguyễn An', members: ['Nguyễn An', 'Trần Bình', 'Nguyễn Chi'] },
  {
    name: 'Lê Dũng',
    members: ['Lê Dũng', 'Phạm Hà', 'Lê Khánh', 'Lê Linh', 'Lê Mai'],
  },
  { name: 'Trần Nam', members: ['Trần Nam', 'Đỗ Ngọc'] },
  {
    name: 'Phạm Phúc',
    members: ['Phạm Phúc', 'Vũ Quỳnh', 'Phạm Sơn', 'Phạm Tú'],
  },
];
const diagnoses = [
  { code: 'Z00.0', name: 'Khám sức khỏe tổng quát' },
  { code: 'Z71.3', name: 'Tư vấn dinh dưỡng' },
  { code: 'J30.9', name: 'Viêm mũi dị ứng, chưa xác định' },
  { code: 'K21.9', name: 'Theo dõi trào ngược dạ dày thực quản' },
];

async function main() {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
    target.port !== '55432'
  ) {
    throw new Error(
      'Script này dùng database PostgreSQL local của dự án ở cổng 55432.',
    );
  }
  const prisma = new PrismaClient();
  try {
    const today = todayInVietnam();
    const historyDate = new Date(today.getTime() - 14 * 86_400_000);
    const start = new Date(today.getTime() - 21 * 86_400_000);
    const passwordHash = await hash(
      process.env.BOOKS_DEMO_PASSWORD || 'Famidoc@123',
      12,
    );
    const packageRow = await prisma.servicePackage.findFirst({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        maxMembers: { gte: 5 },
        durationMonths: { gte: 3 },
      },
      orderBy: { maxMembers: 'desc' },
      select: { id: true },
    });
    if (!packageRow)
      throw new Error(
        'Cần có gói đang bán cho tối thiểu 5 người, thời hạn từ 3 tháng.',
      );
    const carePackage = await new CarePackagesRepositoryImpl(
      prisma as PrismaService,
    ).findById(packageRow.id);
    if (!carePackage) throw new Error('Không đọc được gói dịch vụ.');

    let assignedDoctorEmail = doctorEmail;
    await prisma.$transaction(
      async (tx) => {
        const users = [
          {
            index: 1,
            email: doctorEmail,
            name: 'DEMO - Bác sĩ Minh An',
            role: 'DOCTOR' as const,
          },
          {
            index: 2,
            email: 'facility.books@demo.famidoc.invalid',
            name: 'DEMO - Cơ sở sổ khám',
            role: 'HEALTHCARE_FACILITY' as const,
          },
          ...families.map((family, index) => ({
            index: index + 3,
            email: `family.books${index + 1}@demo.famidoc.invalid`,
            name: `DEMO - Gia đình ${family.name}`,
            role: 'FAMILY_REP' as const,
          })),
        ];
        for (const user of users) {
          const existing = await tx.user.findUnique({
            where: { id: id(1, user.index) },
            select: { email: true },
          });
          if (existing && existing.email !== user.email)
            throw new Error('ID dữ liệu mẫu bị trùng với tài khoản khác.');
          await tx.user.upsert({
            where: { id: id(1, user.index) },
            update: {},
            create: {
              id: id(1, user.index),
              email: user.email,
              phone: `+84999020${String(user.index).padStart(3, '0')}`,
              fullName: user.name,
              role: user.role,
              passwordHash,
              status: 'ACTIVE',
            },
          });
        }
        await tx.healthcareFacility.upsert({
          where: { id: id(2) },
          update: {},
          create: {
            id: id(2),
            userId: id(1, 2),
            facilityName: 'DEMO - Cơ sở sổ khám gia đình',
            licenseNumber: 'DEMO-BOOKS-LICENSE',
            taxCode: 'DEMO-BOOKS-TAX',
            address: 'Địa chỉ mẫu để trải nghiệm giao diện',
            hotline: '+84999020002',
            bankName: 'DEMO_BANK',
            bankAccountNumber: '0000000000',
            bankAccountHolder: 'DEMO ONLY',
            verificationStatus: 'ACTIVE',
          },
        });
        await tx.doctor.upsert({
          where: { id: id(3) },
          update: {},
          create: {
            id: id(3),
            userId: id(1),
            facilityId: id(2),
            doctorName: 'DEMO - Bác sĩ Minh An',
            specialty: 'Y học gia đình',
            experienceYears: 8,
            onboardingStatus: 'ACTIVE',
            activePanelCount: 4,
            maxPanelCapacity: 30,
            bio: 'Tài khoản và hồ sơ giả lập để trải nghiệm sổ khám, kê đơn.',
          },
        });
        await tx.b2bStaffingContract.upsert({
          where: { contractCode: 'DEMO-BOOKS-B2B' },
          update: {},
          create: {
            contractCode: 'DEMO-BOOKS-B2B',
            facilityId: id(2),
            platformCommissionRate: 15,
            facilityRevenueRate: 85,
            startDate: start,
            endDate: addContractMonths(today, 12),
            status: 'ACTIVE',
          },
        });

        const requestedDoctor = await tx.doctor.findFirst({
          where: {
            user: {
              email: requestedDoctorEmail,
              role: 'DOCTOR',
              status: 'ACTIVE',
            },
            onboardingStatus: 'ACTIVE',
            facility: { verificationStatus: 'ACTIVE' },
          },
          select: {
            id: true,
            facilityId: true,
            user: { select: { email: true } },
          },
        });
        if (!requestedDoctor && process.env.BOOKS_DEMO_DOCTOR_EMAIL)
          throw new Error(
            'Không tìm thấy bác sĩ đang hoạt động theo email đã chọn.',
          );
        const assignedDoctor =
          requestedDoctor ??
          (await tx.doctor.findUniqueOrThrow({
            where: { id: id(3) },
            select: {
              id: true,
              facilityId: true,
              user: { select: { email: true } },
            },
          }));
        assignedDoctorEmail = assignedDoctor.user.email;
        const affectedDoctors = new Set([id(3), assignedDoctor.id]);

        for (const [familyIndex, family] of families.entries()) {
          const familyNumber = familyIndex + 1;
          const familyId = id(4, familyNumber);
          const contractId = id(5, familyNumber);
          await tx.familyUnit.upsert({
            where: { id: familyId },
            update: {},
            create: {
              id: familyId,
              representativeUserId: id(1, familyIndex + 3),
              homeAddress: `DEMO - Địa chỉ gia đình ${family.name}`,
              emergencyPhone: `+84999020${String(familyIndex + 3).padStart(3, '0')}`,
            },
          });
          const quote = calculateCarePackageQuote(
            carePackage,
            family.members.length,
          );
          const snapshot = {
            package: quote.package,
            members: quote.members,
            pricing: quote.pricing,
            benefits: quote.benefits,
          };
          const currentContract = await tx.medicalContract.findUnique({
            where: { id: contractId },
            select: { contractNumber: true, isDemo: true, doctorId: true },
          });
          if (
            currentContract &&
            (!currentContract.isDemo ||
              currentContract.contractNumber !== `DEMO-BOOKS-F${familyNumber}`)
          ) {
            throw new Error('Hợp đồng dữ liệu mẫu bị trùng với dữ liệu khác.');
          }
          if (currentContract?.doctorId)
            affectedDoctors.add(currentContract.doctorId);
          await tx.medicalContract.upsert({
            where: { id: contractId },
            update: {
              doctorId: assignedDoctor.id,
              facilityId: assignedDoctor.facilityId,
            },
            create: {
              id: contractId,
              contractNumber: `DEMO-BOOKS-F${familyNumber}`,
              familyId,
              facilityId: assignedDoctor.facilityId,
              doctorId: assignedDoctor.id,
              packageId: carePackage.id,
              totalAmount: quote.pricing.totalPriceVnd,
              remainingHomeVisits: quote.benefits.quotas.homeVisits,
              remainingTelehealth: quote.benefits.quotas.videoConsultations,
              memberCount: family.members.length,
              startDate: start,
              endDate: addContractMonths(start, carePackage.durationMonths),
              contractStatus: 'ACTIVE',
              isDemo: true,
              billingSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            },
          });
          for (const [memberIndex, name] of family.members.entries()) {
            const number = familyNumber * 100 + memberIndex + 1;
            const patientId = id(6, number);
            await tx.patient.upsert({
              where: { id: patientId },
              update: {},
              create: {
                id: patientId,
                familyId,
                fullName: `DEMO - ${name}`,
                gender: memberIndex % 2 ? 'FEMALE' : 'MALE',
                dateOfBirth: new Date(
                  `${memberIndex < 2 ? 1986 + familyIndex + memberIndex : 2010 + memberIndex}-03-15T00:00:00Z`,
                ),
                relationshipToHead:
                  memberIndex === 0
                    ? 'SELF'
                    : memberIndex === 1
                      ? 'SPOUSE'
                      : 'CHILD',
              },
            });
            await tx.contractMember.upsert({
              where: { contractId_patientId: { contractId, patientId } },
              update: {},
              create: { contractId, patientId },
            });
            for (const [visitIndex, date] of [historyDate, today].entries()) {
              const encounterId = id(7, number * 10 + visitIndex);
              const emrId = id(8, number * 10 + visitIndex);
              const diagnosis =
                diagnoses[
                  (familyIndex + memberIndex + visitIndex) % diagnoses.length
                ];
              const finalizedAt = new Date(date.getTime() + 2 * 3_600_000);
              await tx.encounter.upsert({
                where: { id: encounterId },
                update: { doctorId: assignedDoctor.id },
                create: {
                  id: encounterId,
                  contractId,
                  doctorId: assignedDoctor.id,
                  encounterType: familyIndex % 2 ? 'TELEHEALTH' : 'HOME_VISIT',
                  category: 'PERIODIC_ROUTINE',
                  scheduledDate: date,
                  scheduledTime: new Date(
                    `1970-01-01T${String(8 + familyIndex).padStart(2, '0')}:${String(memberIndex * 10).padStart(2, '0')}:00Z`,
                  ),
                  encounterStatus: 'COMPLETED',
                },
              });
              await tx.encounterParticipant.upsert({
                where: { encounterId_patientId: { encounterId, patientId } },
                update: {},
                create: { encounterId, patientId },
              });
              await tx.clinicalEmr.upsert({
                where: { encounterId_patientId: { encounterId, patientId } },
                update: {},
                create: {
                  id: emrId,
                  encounterId,
                  patientId,
                  chiefComplaint: `DỮ LIỆU MẪU - ${diagnosis.name}`,
                  clinicalFindings:
                    'Nội dung khám giả lập để thử giao diện và luồng lấy lại thông tin khám.',
                  icd10Code: diagnosis.code,
                  icd10Diagnosis: diagnosis.name,
                  treatmentPlan:
                    'DỮ LIỆU MẪU - Bác sĩ bổ sung chỉ định khi thử kê đơn, không dùng để điều trị.',
                  isFinalized: true,
                  finalizedAt,
                },
              });
              if (visitIndex === 0 && memberIndex % 2 === 0) {
                await tx.prescription.upsert({
                  where: { prescriptionCode: `DEMO-BOOKS-${number}` },
                  update: {},
                  create: {
                    id: id(9, number),
                    emrId,
                    prescriptionCode: `DEMO-BOOKS-${number}`,
                    recipientUserId: id(1, familyIndex + 3),
                    prescribedDate: date,
                    instructions:
                      'ĐƠN MẪU CHỈ ĐỂ TRẢI NGHIỆM GIAO DIỆN. Không dùng để mua thuốc hoặc điều trị.',
                    clinicalContext: {
                      treatmentMode: 'OUTPATIENT',
                      conclusion: 'Dữ liệu giả lập',
                      precautions: 'Chỉ kiểm thử giao diện',
                      followUpDays: 14,
                    },
                    details: {
                      create: [
                        {
                          medicationName: 'Thuốc minh họa giao diện',
                          medicationCode: 'DEMO-DRUG-01',
                          activeIngredient: 'Hoạt chất mẫu',
                          strength: 'Hàm lượng mẫu',
                          administrationRoute: 'Đường dùng mẫu',
                          dosage: 'Liều minh họa',
                          frequency: 'Tần suất minh họa',
                          quantity: 6,
                          unit: 'Viên',
                          durationDays: 3,
                          lineNumber: 1,
                        },
                      ],
                    },
                  },
                });
              }
            }
          }
        }
        for (const doctorId of affectedDoctors) {
          await tx.doctor.update({
            where: { id: doctorId },
            data: {
              activePanelCount: await tx.medicalContract.count({
                where: { doctorId, contractStatus: 'ACTIVE' },
              }),
            },
          });
        }
      },
      { timeout: 60_000 },
    );
    console.log(
      JSON.stringify(
        {
          doctorEmail: assignedDoctorEmail,
          date: today.toISOString().slice(0, 10),
          families: families.map((family, index) => ({
            name: `DEMO - Gia đình ${family.name}`,
            members: family.members.length,
            email: `family.books${index + 1}@demo.famidoc.invalid`,
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
