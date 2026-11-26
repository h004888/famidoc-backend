import { BadRequestException } from '@nestjs/common';
import { BaseApiException } from '../../../core/exceptions/api.exception';
import { carePackagesValidationPipe } from '../care-packages-validation.pipe';
import { CreateCarePackageDto } from '../dtos/create-care-package.dto';
import { UpdateCarePackageDto } from '../dtos/update-care-package.dto';
import { QuotaPeriod } from '../entities/care-package.entity';
import { validateCarePackageTerms } from '../validate-care-package-terms';

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Gói Chăm Sóc Gia Đình Toàn Diện',
    description: 'Gói chăm sóc sức khỏe định kỳ tại nhà và tư vấn video cho cả gia đình.',
    durationMonths: 4,
    priceVnd: 3_600_000,
    includedMembers: 2,
    maxMembers: 5,
    additionalMemberMonthlyPriceVnd: 100_000,
    homeVisitUnitPriceVnd: 900_000,
    quotas: {
      homeVisits: 4,
      videoConsultations: 6,
    },
    ...overrides,
  };
}

describe('CreateCarePackageDto, UpdateCarePackageDto & validateCarePackageTerms', () => {
  it('chấp nhận payload tạo mới không cần code, quotaPeriod, videoQuotaPolicy, facilityVisits, acknowledgedWarnings và durationMonths tùy chỉnh > 0', async () => {
    const dto = await carePackagesValidationPipe.transform(validPayload(), {
      type: 'body',
      metatype: CreateCarePackageDto,
    });
    expect(dto.durationMonths).toBe(4);
    expect(dto.quotas).toEqual({ homeVisits: 4, videoConsultations: 6 });
  });

  it('từ chối durationMonths <= 0 với thông báo tiếng Việt', async () => {
    try {
      await carePackagesValidationPipe.transform(validPayload({ durationMonths: 0 }), {
        type: 'body',
        metatype: CreateCarePackageDto,
      });
      throw new Error('Expected validation error');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const res = (err as BadRequestException).getResponse() as { message: string[] };
      expect(res.message).toContain('Thời hạn gói phải lớn hơn 0 tháng.');
    }
  });

  it('từ chối quotas.videoConsultations <= 0 và quotas.homeVisits <= 0 với thông báo tiếng Việt', async () => {
    try {
      await carePackagesValidationPipe.transform(
        validPayload({ quotas: { homeVisits: 0, videoConsultations: 0 } }),
        { type: 'body', metatype: CreateCarePackageDto },
      );
      throw new Error('Expected validation error');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const res = (err as BadRequestException).getResponse() as { message: string[] };
      expect(res.message).toContain('quotas.Số lượt khám tại nhà phải lớn hơn 0.');
      expect(res.message).toContain('quotas.Số lượt tư vấn video phải lớn hơn 0.');
    }
  });

  it('từ chối các trường đã bỏ như quotas.facilityVisits và acknowledgedWarnings', async () => {
    await expect(
      carePackagesValidationPipe.transform(
        validPayload({ quotas: { homeVisits: 2, videoConsultations: 2, facilityVisits: 0 } }),
        { type: 'body', metatype: CreateCarePackageDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      carePackagesValidationPipe.transform(validPayload({ acknowledgedWarnings: ['P2'] }), {
        type: 'body',
        metatype: CreateCarePackageDto,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      carePackagesValidationPipe.transform({ durationMonths: 5 }, {
        type: 'body',
        metatype: UpdateCarePackageDto,
      }),
    ).resolves.toMatchObject({ durationMonths: 5 });
  });

  it('validateCarePackageTerms kiểm tra quan hệ trường với invalidParams tiếng Việt', () => {
    expect(() =>
      validateCarePackageTerms({
        ...validPayload(),
        maxMembers: 1,
        includedMembers: 2,
        quotaPeriod: QuotaPeriod.PER_TERM,
      } as any),
    ).toThrow(BaseApiException);

    expect(() =>
      validateCarePackageTerms({
        ...validPayload(),
        maxMembers: 2,
        includedMembers: 2,
        additionalMemberMonthlyPriceVnd: 50_000,
        quotaPeriod: QuotaPeriod.PER_TERM,
      } as any),
    ).toThrow(BaseApiException);

    expect(() =>
      validateCarePackageTerms({
        ...validPayload(),
        homeVisitUnitPriceVnd: 900_000,
        priceVnd: 1_000_000,
        quotas: { homeVisits: 4, videoConsultations: 6 } as any,
        quotaPeriod: QuotaPeriod.PER_TERM,
      }),
    ).toThrow(BaseApiException);
  });
});
