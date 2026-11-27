import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  BaseApiException,
  ResourceNotFoundException,
} from '../../../core/exceptions/api.exception';
import { CarePackagesServiceImpl } from '../services/impl/care-packages.service.impl';
import { InMemoryCarePackagesRepository } from '../repositories/impl/in-memory-care-packages.repository';
import { DEMO_CARE_PACKAGE_IDS } from '../repositories/interfaces/care-packages.repository.interface';
import { CreateCarePackageDto } from '../dtos/create-care-package.dto';
import { AdminListCarePackagesDto } from '../dtos/list-care-packages.dto';
import { UpdateCarePackageDto } from '../dtos/update-care-package.dto';
import { carePackagesValidationPipe } from '../care-packages-validation.pipe';

const makeInput = (
  overrides: Partial<CreateCarePackageDto> = {},
): CreateCarePackageDto => ({
  name: 'Gói Chăm Sóc Demo Gia Đình',
  description: 'Mô tả gói chăm sóc sức khỏe gia đình tiêu chuẩn.',
  durationMonths: 1,
  priceVnd: 1_000_000,
  includedMembers: 2,
  maxMembers: 4,
  additionalMemberMonthlyPriceVnd: 50_000,
  quotas: { videoConsultations: 2, homeVisits: 1 },
  ...overrides,
});

describe('Care package form validation', () => {
  const createMetadata = { type: 'body' as const, metatype: CreateCarePackageDto };
  const updateMetadata = { type: 'body' as const, metatype: UpdateCarePackageDto };

  it('trims text and accepts custom durationMonths > 0 without code or quotaPeriod', async () => {
    const body = makeInput({
      durationMonths: 4,
      name: '  Gói 4 tháng  ',
      description: '  Khám tại nhà 2 lượt mỗi kỳ.  ',
    });
    await expect(
      carePackagesValidationPipe.transform(body, createMetadata),
    ).resolves.toMatchObject({
      durationMonths: 4,
      name: 'Gói 4 tháng',
      description: 'Khám tại nhà 2 lượt mỗi kỳ.',
    });
  });

  it.each([
    { durationMonths: 0 },
    { name: '  Gói  ' },
    { description: '  Khám tại nhà 2 lượt  ' },
    { description: undefined },
  ])('rejects invalid create data %j', async (changes) => {
    const body = { ...makeInput(), ...changes };
    await expect(
      carePackagesValidationPipe.transform(body, createMetadata),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows partial updates and validates supplied text', async () => {
    await expect(
      carePackagesValidationPipe.transform({ priceVnd: 200_000 }, updateMetadata),
    ).resolves.toMatchObject({ priceVnd: 200_000 });
    await expect(
      carePackagesValidationPipe.transform({ name: 'Gói' }, updateMetadata),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      carePackagesValidationPipe.transform({ description: null }, updateMetadata),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      carePackagesValidationPipe.transform({ description: ' ' }, updateMetadata),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CarePackagesServiceImpl', () => {
  let service: CarePackagesServiceImpl;
  let repository: InMemoryCarePackagesRepository;

  beforeEach(() => {
    repository = new InMemoryCarePackagesRepository();
    service = new CarePackagesServiceImpl(repository);
  });

  it('starts with an empty catalog', async () => {
    expect(await service.listPublic({ page: 1, limit: 20 })).toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });
  });

  it('tự sinh code duy nhất <= 40 ký tự khi tạo gói mới, cố định PER_TERM & FIXED, không có facilityVisits', async () => {
    const item = await service.create(makeInput({ durationMonths: 4 }));
    expect(item.code).toMatch(/^PKG_\d{8}_[A-F0-9]{6}$/);
    expect(item.code.length).toBeLessThanOrEqual(40);
    expect(item).toMatchObject({
      version: 1,
      status: 'ACTIVE',
      currency: 'VND',
      quotaPeriod: 'PER_TERM',
      videoQuotaPolicy: 'FIXED',
      quotas: { videoConsultations: 2, homeVisits: 1 },
    });
    expect(item.quotas).not.toHaveProperty('facilityVisits');
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(item.publishedAt).not.toBeNull();
    expect((await service.listPublic({ page: 1, limit: 20 })).total).toBe(1);
    expect(await service.getPublic(item.id)).toEqual(item);
    expect((await service.quote(item.id, { memberCount: 2 })).pricing.totalPriceVnd).toBe(item.priceVnd);
  });

  it('tạo đồng thời hai gói vẫn sinh hai mã code khác nhau và không trùng DB', async () => {
    const results = await Promise.allSettled([
      service.create(makeInput()),
      service.create(makeInput()),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    const [first, second] = results.map((r) => (r as PromiseFulfilledResult<any>).value);
    expect(first.code).not.toBe(second.code);
  });

  it('rejects invalid member bounds and empty/zero quotas', async () => {
    await expect(service.create(makeInput({ maxMembers: 1 }))).rejects.toBeInstanceOf(
      BaseApiException,
    );
    await expect(service.create(makeInput({ maxMembers: 2 }))).rejects.toBeInstanceOf(
      BaseApiException,
    );
    await expect(
      service.create(makeInput({ quotas: { videoConsultations: 0, homeVisits: 1 } })),
    ).rejects.toBeInstanceOf(BaseApiException);
    await expect(
      service.create(makeInput({ quotas: { videoConsultations: 2, homeVisits: 0 } })),
    ).rejects.toThrow('ít nhất 1 lượt khám tại nhà');
  });

  it('updates package values, preserving explicitly supplied zero', async () => {
    const item = await service.create(makeInput());
    const updated = await service.update(item.id, {
      additionalMemberMonthlyPriceVnd: 0,
    });
    expect(updated.additionalMemberMonthlyPriceVnd).toBe(0);
    expect(updated.priceVnd).toBe(item.priceVnd);
    await expect(service.update(item.id, {})).rejects.toBeInstanceOf(BaseApiException);
  });

  it('validates partial edits against the current package', async () => {
    const item = await service.create(makeInput());
    await expect(service.update(item.id, { includedMembers: 5 })).rejects.toBeInstanceOf(
      BaseApiException,
    );
    expect((await service.getAdmin(item.id)).includedMembers).toBe(2);
  });

  it('does not expose mutable references from the repository', async () => {
    const input = makeInput();
    const item = await service.create(input);
    input.quotas.videoConsultations = 999;
    item.quotas.videoConsultations = 888;
    expect((await service.getAdmin(item.id)).quotas.videoConsultations).toBe(2);
    const page = await service.listAdmin({ page: 1, limit: 20 });
    page.items[0].quotas.homeVisits = 999;
    expect((await service.getAdmin(item.id)).quotas.homeVisits).toBe(1);
  });

  it('allows editing active terms directly without creating new versions', async () => {
    const item = await service.create(makeInput());
    expect(await service.getPublic(item.id)).toEqual(item);
    const updated = await service.update(item.id, { priceVnd: 1_100_000 });
    expect(updated.priceVnd).toBe(1_100_000);
    expect(updated.id).toBe(item.id);
    expect(updated.version).toBe(1);
    expect(updated.status).toBe('ACTIVE');
    expect((await service.listAdmin({ page: 1, limit: 20 })).total).toBe(1);
    await expect(service.getPublic(item.id)).resolves.toMatchObject({ priceVnd: 1_100_000 });
    await expect(service.publish(item.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a new version without changing old prices or quotas', async () => {
    const old = await service.create(makeInput());
    const draft = await service.createVersion(old.id);
    expect(draft).toMatchObject({
      code: old.code,
      version: 2,
      status: 'DRAFT',
      publishedAt: null,
    });
    await service.update(draft.id, {
      priceVnd: 1_100_000,
      quotas: { videoConsultations: 4, homeVisits: 1 },
    });
    await service.publish(draft.id);
    expect(await service.getAdmin(old.id)).toMatchObject({
      priceVnd: 1_000_000,
      status: 'DEPRECATED',
      quotas: old.quotas,
    });
    const publicList = await service.listPublic({ page: 1, limit: 20 });
    expect(publicList.total).toBe(1);
    expect(publicList.items[0].id).toBe(draft.id);
    await expect(service.getPublic(old.id)).rejects.toBeInstanceOf(ResourceNotFoundException);
  });

  it('cho phép tự do đơn giá và phụ phí (đã bỏ P1, P2, P4, P5, P6) và S2 chỉ trả INFO không chặn lưu', async () => {
    // Đơn giá 200.000đ (trước đây bị P1 chặn) và phụ phí 300.000đ (trước đây P5 cảnh báo) + 6 lượt/tháng (S2)
    const created = await service.create(
      makeInput({
        durationMonths: 4,
        priceVnd: 200_000,
        additionalMemberMonthlyPriceVnd: 300_000,
        quotas: { videoConsultations: 23, homeVisits: 1 },
      }),
    );
    expect(created.priceVnd).toBe(200_000);
    expect(created.durationMonths).toBe(4);

    const validation = await service.validate(
      makeInput({
        durationMonths: 1,
        priceVnd: 5_000_000,
        quotas: { videoConsultations: 5, homeVisits: 1 },
      }),
    );
    expect(validation.ok).toBe(true);
    expect(validation.requiresAcknowledgement).toEqual([]);
    expect(validation.findings.find((f) => f.code === 'S2')?.level).toBe('INFO');
  });

  it('rejects packages whose home + video visits exceed 7 per month (S1)', async () => {
    await expect(
      service.create(makeInput({ quotas: { videoConsultations: 6, homeVisits: 2 } })),
    ).rejects.toMatchObject({
      errorCode: 'CARE_PACKAGE_RULE_BLOCKED',
    });
    await expect(
      service.create(makeInput({ quotas: { videoConsultations: 50, homeVisits: 8 } })),
    ).rejects.toThrow('vượt trần tối đa 7 lượt');
  });

  it('excludes demo packages from admin catalog', async () => {
    await repository.insert({
      id: DEMO_CARE_PACKAGE_IDS[0],
      code: 'TRAI_NGHIEM',
      version: 1,
      name: 'Demo',
      description: 'Demo description for testing.',
      durationMonths: 1,
      priceVnd: 1_000_000,
      includedMembers: 1,
      maxMembers: 2,
      additionalMemberMonthlyPriceVnd: 0,
      currency: 'VND',
      quotaPeriod: 'PER_TERM' as any,
      quotas: { videoConsultations: 1, homeVisits: 1 },
      status: 'ACTIVE' as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
      retiredAt: null,
    });
    const adminPage = await service.listAdmin(new AdminListCarePackagesDto());
    expect(adminPage.total).toBe(0);
  });

  it('reports a missing package', async () => {
    await expect(service.getAdmin('missing')).rejects.toBeInstanceOf(ResourceNotFoundException);
    await expect(service.getPublic('missing')).rejects.toBeInstanceOf(ResourceNotFoundException);
  });

  it('xóa mềm thành công gói DEPRECATED/DRAFT, chặn xóa gói ACTIVE và gói đang được sử dụng', async () => {
    const active = await service.create(makeInput());
    await expect((service as any).remove(active.id)).rejects.toMatchObject({
      errorCode: 'CARE_PACKAGE_ACTIVE_DELETE_BLOCKED',
    });

    await service.retire(active.id);
    const deleted = await (service as any).remove(active.id);
    expect(deleted.id).toBe(active.id);
    expect(typeof deleted.deletedAt).toBe('string');

    expect((await service.listAdmin({ page: 1, limit: 20 })).total).toBe(0);
    await expect(service.getAdmin(active.id)).rejects.toBeInstanceOf(ResourceNotFoundException);

    const inUse = await service.create(makeInput());
    await service.retire(inUse.id);
    (repository as any).inUseIds.add(inUse.id);
    await expect((service as any).remove(inUse.id)).rejects.toMatchObject({
      errorCode: 'CARE_PACKAGE_IN_USE',
    });
  });
});
