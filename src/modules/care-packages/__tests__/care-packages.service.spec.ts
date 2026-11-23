import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CarePackagesServiceImpl } from '../services/impl/care-packages.service.impl';
import { QuotaPeriod } from '../entities/care-package.entity';
import { InMemoryCarePackagesRepository } from '../repositories/impl/in-memory-care-packages.repository';
import { DEMO_CARE_PACKAGE_IDS } from '../repositories/interfaces/care-packages.repository.interface';
import { CreateCarePackageDto } from '../dtos/create-care-package.dto';
import { UpdateCarePackageDto } from '../dtos/update-care-package.dto';
import { carePackagesValidationPipe } from '../care-packages-validation.pipe';

// Dữ liệu chỉ dành cho test, không phải giá hay quyền lợi FamiDoc đã được phê duyệt.
const makeInput = (
  overrides: Partial<CreateCarePackageDto> = {},
): CreateCarePackageDto => ({
  code: 'DEMO',
  name: 'Demo package',
  description: 'Example care package description.',
  durationMonths: 1,
  priceVnd: 100_000,
  includedMembers: 2,
  maxMembers: 4,
  additionalMemberMonthlyPriceVnd: 50_000,
  quotaPeriod: QuotaPeriod.PER_TERM,
  quotas: { videoConsultations: 5, homeVisits: 0, facilityVisits: 0 },
  ...overrides,
});

describe('Care package form validation', () => {
  const createMetadata = { type: 'body' as const, metatype: CreateCarePackageDto };
  const updateMetadata = { type: 'body' as const, metatype: UpdateCarePackageDto };

  it.each(['7', '3-gói Cơ bản'])(
    'accepts code %s and trims text at the minimum lengths',
    async (code) => {
      const body = makeInput({
        code: `  ${code}  `,
        name: '  Gói 3 tuần  ',
        description: '  Khám tại nhà 2 lượt.  ',
      });
      await expect(
        carePackagesValidationPipe.transform(body, createMetadata),
      ).resolves.toMatchObject({
        code,
        name: 'Gói 3 tuần',
        description: 'Khám tại nhà 2 lượt.',
      });
    },
  );

  it.each([
    { code: '  ' },
    { code: 'x'.repeat(41) },
    { name: '  Gói tháng  ' },
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
      carePackagesValidationPipe.transform({ name: 'Gói tháng' }, updateMetadata),
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

  it('starts with an empty catalog, not assumed official packages', async () => {
    expect(await service.listPublic({ page: 1, limit: 20 })).toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });
  });

  it('creates an active package ready for purchase with server-owned identity and version', async () => {
    const item = await service.create(makeInput());
    expect(item).toMatchObject({
      code: 'DEMO',
      version: 1,
      status: 'ACTIVE',
      currency: 'VND',
      description: makeInput().description,
    });
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(item.publishedAt).not.toBeNull();
    expect((await service.listPublic({ page: 1, limit: 20 })).total).toBe(1);
    expect(await service.getPublic(item.id)).toEqual(item);
    expect((await service.quote(item.id, { memberCount: 2 })).pricing.totalPriceVnd).toBe(item.priceVnd);
  });

  it('rejects a duplicate code, including simultaneous creation', async () => {
    const results = await Promise.allSettled([
      service.create(makeInput()),
      service.create(makeInput()),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
  });

  it('rejects a member ceiling below the included count', async () => {
    await expect(
      service.create(makeInput({ maxMembers: 1 })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects extra-member charges when adding members is disabled', async () => {
    await expect(
      service.create(makeInput({ maxMembers: 2 })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires at least one included service', async () => {
    await expect(
      service.create(
        makeInput({
          quotas: { videoConsultations: 0, homeVisits: 0, facilityVisits: 0 },
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates package values, preserving explicitly supplied zero', async () => {
    const item = await service.create(makeInput());
    const updated = await service.update(item.id, {
      additionalMemberMonthlyPriceVnd: 0,
    });
    expect(updated.additionalMemberMonthlyPriceVnd).toBe(0);
    expect(updated.priceVnd).toBe(item.priceVnd);
    await expect(service.update(item.id, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('validates partial edits against the current package', async () => {
    const item = await service.create(makeInput());
    await expect(
      service.update(item.id, { includedMembers: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((await service.getAdmin(item.id)).includedMembers).toBe(2);
  });

  it('does not expose mutable references from the repository', async () => {
    const input = makeInput();
    const item = await service.create(input);
    input.quotas.videoConsultations = 999;
    item.quotas.videoConsultations = 888;
    expect((await service.getAdmin(item.id)).quotas.videoConsultations).toBe(5);
    const page = await service.listAdmin({ page: 1, limit: 20 });
    page.items[0].quotas.homeVisits = 999;
    expect((await service.getAdmin(item.id)).quotas.homeVisits).toBe(0);
  });

  it('allows editing active terms directly without creating new versions', async () => {
    const item = await service.create(makeInput());
    expect(await service.getPublic(item.id)).toEqual(item);
    const updated = await service.update(item.id, { priceVnd: 200_000 });
    expect(updated.priceVnd).toBe(200_000);
    expect(updated.id).toBe(item.id);
    expect(updated.version).toBe(1);
    await expect(service.publish(item.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
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
      priceVnd: 200_000,
      quotas: { videoConsultations: 10, homeVisits: 1, facilityVisits: 0 },
    });
    await service.publish(draft.id);
    expect(await service.getAdmin(old.id)).toMatchObject({
      priceVnd: 100_000,
      status: 'DEPRECATED',
      quotas: old.quotas,
    });
    const publicList = await service.listPublic({ page: 1, limit: 20 });
    expect(publicList.total).toBe(1);
    expect(publicList.items[0].id).toBe(draft.id);
    await expect(service.getPublic(old.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('does not create versions from a draft or an outdated source', async () => {
    const first = await service.create(makeInput());
    const second = await service.createVersion(first.id);
    await expect(service.createVersion(second.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.createVersion(first.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await service.publish(second.id);
    await expect(service.createVersion(first.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('serializes competing version creation through the repository unique constraint', async () => {
    const item = await service.create(makeInput());
    const results = await Promise.allSettled([
      service.createVersion(item.id),
      service.createVersion(item.id),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect((await service.listAdmin({ page: 1, limit: 20 })).total).toBe(2);
  });

  it('retires without deleting old terms and is idempotent', async () => {
    const item = await service.create(makeInput());
    const draft = await service.createVersion(item.id);
    await expect(service.retire(draft.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    const retired = await service.retire(item.id);
    expect(await service.retire(item.id)).toEqual(retired);
    expect((await service.listPublic({ page: 1, limit: 20 })).total).toBe(0);
    expect((await service.getAdmin(item.id)).priceVnd).toBe(100_000);
  });

  it('reopens a retired package with the same identity and terms', async () => {
    const item = await service.create(makeInput());
    await service.retire(item.id);

    const reopened = await service.reopen(item.id);
    expect(reopened).toMatchObject({
      id: item.id, code: item.code, version: item.version,
      priceVnd: item.priceVnd, quotas: item.quotas,
      status: 'ACTIVE', retiredAt: null,
    });
    expect(await service.getPublic(item.id)).toEqual(reopened);
    expect((await service.listPublic({ page: 1, limit: 20 })).items).toHaveLength(1);
  });

  it('rejects reopening a draft, an active package, or a superseded version', async () => {
    const item = await service.create(makeInput());
    await expect(service.reopen(item.id)).rejects.toBeInstanceOf(ConflictException);
    const next = await service.createVersion(item.id);
    await expect(service.reopen(next.id)).rejects.toBeInstanceOf(ConflictException);
    await service.publish(next.id);
    await expect(service.reopen(item.id)).rejects.toThrow('phiên bản mới hơn');
    expect((await service.getPublic(next.id)).status).toBe('ACTIVE');
  });

  it('paginates and filters admin results', async () => {
    await service.create(makeInput({ code: 'BB' }));
    await service.create(makeInput({ code: 'AA' }));
    expect(await service.listAdmin({ page: 2, limit: 1 })).toMatchObject({
      total: 2,
      page: 2,
      limit: 1,
      items: [expect.objectContaining({ code: 'BB' })],
    });
    expect((await service.listAdmin({ page: 100, limit: 1 })).items).toEqual(
      [],
    );
  });

  it('excludes demo packages and sorts the full admin catalog by price before pagination', async () => {
    const prices = [700_000, 500_000, 100_000, 600_000, 400_000, 200_000, 300_000];
    for (const [index, priceVnd] of prices.entries()) {
      await service.create(makeInput({ code: `PACKAGE_${index}`, priceVnd }));
    }
    const demo = await service.create(
      makeInput({ code: 'DEMO_LOCAL_TRAI_NGHIEM', priceVnd: 50_000 }),
    );
    await repository.insert({
      ...demo,
      id: DEMO_CARE_PACKAGE_IDS[0],
      code: 'TRAI_NGHIEM',
    });

    const first = await service.listAdmin({ page: 1, limit: 6 });
    const second = await service.listAdmin({ page: 2, limit: 6 });
    expect(first.total).toBe(7);
    expect(first.items.map((item) => item.priceVnd)).toEqual([
      100_000, 200_000, 300_000, 400_000, 500_000, 600_000,
    ]);
    expect(second.items.map((item) => item.priceVnd)).toEqual([700_000]);
  });

  it('reports a missing package', async () => {
    await expect(service.getAdmin('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.getPublic('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects merged concurrent edits that would violate member bounds', async () => {
    const item = await service.create(
      makeInput({ additionalMemberMonthlyPriceVnd: 0 }),
    );
    const results = await Promise.allSettled([
      service.update(item.id, { includedMembers: 4 }),
      service.update(item.id, { maxMembers: 3 }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const final = await service.getAdmin(item.id);
    expect(final.maxMembers).toBeGreaterThanOrEqual(final.includedMembers);
  });

  it('quotes an active package using stored terms without changing the catalog', async () => {
    const item = await service.create(makeInput());
    const before = await service.getAdmin(item.id);
    const quote = await service.quote(item.id, { memberCount: 3 });
    expect(quote.pricing.totalPriceVnd).toBe(150_000);
    expect(quote.package.id).toBe(item.id);
    expect(await service.getAdmin(item.id)).toEqual(before);
    expect((await service.listAdmin({ page: 1, limit: 20 })).total).toBe(1);
  });

  it('does not quote draft, retired or unknown packages', async () => {
    const item = await service.create(makeInput());
    const draft = await service.createVersion(item.id);
    await expect(
      service.quote(draft.id, { memberCount: 2 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await service.retire(item.id);
    await expect(
      service.quote(item.id, { memberCount: 2 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.quote('missing', { memberCount: 2 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('quotes a new active version rather than accepting the old retired version', async () => {
    const first = await service.create(makeInput());
    const second = await service.createVersion(first.id);
    await service.update(second.id, { priceVnd: 200_000 });
    await service.publish(second.id);
    await expect(
      service.quote(first.id, { memberCount: 2 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const quote = await service.quote(second.id, { memberCount: 2 });
    expect(quote.package.version).toBe(2);
    expect(quote.pricing.totalPriceVnd).toBe(200_000);
    expect((await service.getAdmin(first.id)).priceVnd).toBe(100_000);
  });
});
