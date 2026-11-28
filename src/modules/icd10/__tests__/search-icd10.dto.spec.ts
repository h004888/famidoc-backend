import { ValidationPipe } from '@nestjs/common';
import { SearchIcd10Dto } from '../dtos/search-icd10.dto';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

async function expectValidationError(query: Record<string, unknown>, expectedMessage: string) {
  try {
    await pipe.transform(query, { type: 'query', metatype: SearchIcd10Dto });
    throw new Error('Expected validation rejection');
  } catch (error) {
    const response = (error as { getResponse(): { message: string[] } }).getResponse();
    expect(response.message.join('; ')).toContain(expectedMessage);
  }
}

describe('SearchIcd10Dto', () => {
  it('rejects empty q with Vietnamese message', async () => {
    await expectValidationError({ q: '' }, 'Từ khóa tra cứu phải từ 1 đến 100 ký tự.');
  });

  it('rejects whitespace-only q after trim with Vietnamese message', async () => {
    await expectValidationError({ q: '   ' }, 'Từ khóa tra cứu phải từ 1 đến 100 ký tự.');
  });

  it('rejects q longer than 100 characters with Vietnamese message', async () => {
    await expectValidationError(
      { q: 'a'.repeat(101) },
      'Từ khóa tra cứu phải từ 1 đến 100 ký tự.',
    );
  });

  it('accepts valid q and transforms primaryOnly and limit', async () => {
    const dto = await pipe.transform(
      { q: '  I10  ', primaryOnly: 'true', limit: '25' },
      { type: 'query', metatype: SearchIcd10Dto },
    );

    expect(dto).toBeInstanceOf(SearchIcd10Dto);
    expect(dto.q).toBe('I10');
    expect(dto.primaryOnly).toBe(true);
    expect(dto.limit).toBe(25);
  });
});
