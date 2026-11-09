import { Prisma } from '@prisma/client';

describe('Prisma Schema Contract Members and Nullable Doctor (Task 1)', () => {
  it('should have ContractMember in Prisma model delegate names', () => {
    // Model delegate must exist on Prisma client
    const dmmfModels = Prisma.dmmf?.datamodel?.models || [];
    const contractMemberModel = dmmfModels.find(
      (m) => m.name === 'ContractMember',
    );
    expect(contractMemberModel).toBeDefined();
    expect(contractMemberModel?.fields.some((f) => f.name === 'contractId')).toBe(
      true,
    );
    expect(contractMemberModel?.fields.some((f) => f.name === 'patientId')).toBe(
      true,
    );
  });

  it('should allow doctorId in MedicalContract to be optional / nullable', () => {
    const dmmfModels = Prisma.dmmf?.datamodel?.models || [];
    const medicalContract = dmmfModels.find(
      (m) => m.name === 'MedicalContract',
    );
    expect(medicalContract).toBeDefined();
    const doctorIdField = medicalContract?.fields.find(
      (f) => f.name === 'doctorId',
    );
    expect(doctorIdField).toBeDefined();
    expect(doctorIdField?.isRequired).toBe(false);
  });
});
