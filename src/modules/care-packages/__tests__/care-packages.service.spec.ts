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
import { AdminListCarePackagesDto } from '../dtos/list-care-packages.dto';
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
  priceVnd: 1_000_000,
  includedMembers: 2,
  maxMembers: 4,
  additionalMemberMonthlyPriceVnd: 50_000,
  quotaPeriod: QuotaPeriod.PER_TERM,
  quotas: { videoConsultations: 2, homeVisits: 1, facilityVisits: 0 },
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
      acknowledgedWarnings: ['P5'],
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
      priceVnd: 1_100_000,
      quotas: { videoConsultations: 4, homeVisits: 1, facilityVisits: 0 },
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
    expect((await service.getAdmin(item.id)).priceVnd).toBe(1_000_000);
  });

  it.each([false, true])('reopens the same retired package with a legacy draft present=%s', async (hasDraft) => {
    const item = await service.create(makeInput());
    const draft = hasDraft ? await service.createVersion(item.id) : null;
    await service.retire(item.id);

    const reopened = await service.reopen(item.id);
    expect(reopened).toMatchObject({
      id: item.id, code: item.code, version: item.version,
      priceVnd: item.priceVnd, quotas: item.quotas,
      status: 'ACTIVE', retiredAt: null,
    });
    expect(await service.getPublic(item.id)).toEqual(reopened);
    expect((await service.listPublic({ page: 1, limit: 20 })).items).toHaveLength(1);
    if (draft) expect((await service.getAdmin(draft.id)).status).toBe('DRAFT');
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

  it('hides legacy drafts and lists active packages before cheaper retired ones across pages', async () => {
    const active = await service.create(makeInput({ code: 'CURRENT', priceVnd: 1_100_000 }));
    const draft = await service.createVersion(active.id);
    const retired = await service.create(makeInput({ code: 'RETIRED', priceVnd: 1_050_000 }));
    await service.retire(retired.id);
    await service.update(draft.id, { priceVnd: 1_000_000 });

    const query = await carePackagesValidationPipe.transform(
      { page: '1', limit: '1', excludeDrafts: 'true' },
      { type: 'query', metatype: AdminListCarePackagesDto },
    );
    expect(await service.listAdmin(query)).toMatchObject({
      total: 2,
      items: [expect.objectContaining({ id: active.id, status: 'ACTIVE' })],
    });
    expect(await service.listAdmin({ page: 2, limit: 1, excludeDrafts: true })).toMatchObject({
      total: 2,
      items: [expect.objectContaining({ id: retired.id, status: 'DEPRECATED' })],
    });
    expect(await service.listAdmin({ page: 1, limit: 1 })).toMatchObject({
      total: 3,
      items: [expect.objectContaining({ id: draft.id, status: 'DRAFT' })],
    });
  });

  it('excludes demo packages and sorts the full admin catalog by price before pagination', async () => {
    const prices = [1_000_000, 900_000, 700_000, 950_000, 850_000, 750_000, 800_000];
    for (const [index, priceVnd] of prices.entries()) {
      await service.create(makeInput({ code: `PACKAGE_${index}`, priceVnd }));
    }
    const demo = await service.create(
      makeInput({ code: 'DEMO_LOCAL_TRAI_NGHIEM', priceVnd: 690_000 }),
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
      700_000, 750_000, 800_000, 850_000, 900_000, 950_000,
    ]);
    expect(second.items.map((item) => item.priceVnd)).toEqual([1_000_000]);
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
      { ...makeInput({ additionalMemberMonthlyPriceVnd: 0 }), acknowledgedWarnings: ['P5'] },
    );
    const results = await Promise.allSettled([
      service.update(item.id, { includedMembers: 4, acknowledgedWarnings: ['P5'] }),
      service.update(item.id, { maxMembers: 3, acknowledgedWarnings: ['P5'] }),
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
    expect(quote.pricing.totalPriceVnd).toBe(1_050_000);
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
    await service.update(second.id, { priceVnd: 1_100_000 });
    await service.publish(second.id);
    await expect(
      service.quote(first.id, { memberCount: 2 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const quote = await service.quote(second.id, { memberCount: 2 });
    expect(quote.package.version).toBe(2);
    expect(quote.pricing.totalPriceVnd).toBe(1_100_000);
    expect((await service.getAdmin(first.id)).priceVnd).toBe(1_000_000);
  });

  it('rejects packages whose home + video visits exceed 7 per month (S1)', async () => {
    await expect(
      service.create(
        makeInput({ quotas: { videoConsultations: 6, homeVisits: 2, facilityVisits: 0 } }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(
        makeInput({ quotas: { videoConsultations: 50, homeVisits: 8, facilityVisits: 0 } }),
      ),
    ).rejects.toThrow('vượt trần 7 lượt');
  });

  it('requires acknowledging risky terms (S2) and records the acknowledgement', async () => {
    const risky = makeInput({ quotas: { videoConsultations: 6, homeVisits: 1, facilityVisits: 0 } });
    await expect(service.create(risky)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'CARE_PACKAGE_RISK_ACK_REQUIRED',
        requiresAcknowledgement: ['S2'],
      }),
    });
    const item = await service.create(
      { ...risky, acknowledgedWarnings: ['S2'] },
      { actorUserId: 'admin-1', clientIp: '127.0.0.1' },
    );
    expect(item.quotas.videoConsultations).toBe(6);
    expect(repository.auditEntries).toEqual([
      expect.objectContaining({
        action: 'CARE_PACKAGE_RISK_ACK_CREATE',
        actorUserId: 'admin-1',
        packageId: item.id,
      }),
    ]);
  });

  it('rejects home-visit unit prices outside 500.000đ – 2.000.000đ (P1) and packages without home visits (P3)', async () => {
    await expect(service.create(makeInput({ priceVnd: 400_000 }))).rejects.toThrow('nằm ngoài khoảng');
    await expect(service.create(makeInput({ priceVnd: 2_100_000 }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.create(
        makeInput({ quotas: { videoConsultations: 2, homeVisits: 0, facilityVisits: 0 } }),
      ),
    ).rejects.toThrow('ít nhất 1 lượt khám tại nhà');
  });

  it('warns when a version changes the price by more than 20% (P6)', async () => {
    const first = await service.create(makeInput());
    const draft = await service.createVersion(first.id);
    await expect(service.update(draft.id, { priceVnd: 1_300_000 })).rejects.toBeInstanceOf(
      ConflictException,
    );
    await service.update(draft.id, { priceVnd: 1_300_000, acknowledgedWarnings: ['P2', 'P6'] });
    await expect(service.publish(draft.id)).rejects.toBeInstanceOf(ConflictException);
    const published = await service.publish(draft.id, { acknowledgedWarnings: ['P2', 'P6'] });
    expect(published.status).toBe('ACTIVE');
  });

  it('validates the approved catalog without blocking errors', async () => {
    const catalog = [
      { code: 'TRAI_NGHIEM', durationMonths: 1, priceVnd: 1_000_000, inc: 1, max: 2, home: 1, video: 1 },
      { code: 'DONG_HANH', durationMonths: 3, priceVnd: 2_850_000, inc: 3, max: 6, home: 3, video: 4 },
      { code: 'AN_TAM', durationMonths: 6, priceVnd: 6_475_000, inc: 4, max: 8, home: 7, video: 8 },
    ] as const;
    for (const p of catalog) {
      const result = await service.validate({
        ...makeInput(),
        code: p.code,
        durationMonths: p.durationMonths,
        priceVnd: p.priceVnd,
        homeVisitUnitPriceVnd: p.priceVnd / p.home,
        includedMembers: p.inc,
        maxMembers: p.max,
        additionalMemberMonthlyPriceVnd: 75_000,
        quotas: { videoConsultations: p.video, homeVisits: p.home, facilityVisits: 0 },
      });
      expect(result).toMatchObject({ ok: true, requiresAcknowledgement: [] });
    }
    const contract = await service.validate({
      ...makeInput(),
      durationMonths: 12,
      priceVnd: 12_600_000,
      homeVisitUnitPriceVnd: 900_000,
      videoQuotaPolicy: 'CONTRACT',
      includedMembers: 6,
      maxMembers: 10,
      additionalMemberMonthlyPriceVnd: 75_000,
      quotas: { videoConsultations: 0, homeVisits: 14, facilityVisits: 0 },
    });
    expect(contract.ok).toBe(true);
    expect(contract.maxContractVideoConsultations).toBe(70);
    // Gói 124 cũ (1 tháng, 15 nhà + 15 video) bị chặn.
    const old124 = await service.validate({
      ...makeInput(),
      priceVnd: 150_000,
      homeVisitUnitPriceVnd: 10_000,
      quotas: { videoConsultations: 15, homeVisits: 15, facilityVisits: 0 },
    });
    expect(old124.ok).toBe(false);
    expect(old124.findings.map((f) => f.code)).toEqual(expect.arrayContaining(['S1', 'P1']));
  });
});
