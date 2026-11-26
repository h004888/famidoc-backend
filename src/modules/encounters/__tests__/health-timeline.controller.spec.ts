import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MedicalBooksController } from '../controllers/medical-books.controller';
import { TimelineQuery } from '../dtos/share-prescription.dto';

describe('TimelineQuery & MedicalBooksController.patientTimeline', () => {
  describe('TimelineQuery validation', () => {
    it('uses defaults when input is empty', async () => {
      const dto = plainToInstance(TimelineQuery, {});
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
      expect(dto.limit).toBe(20);
      expect(dto.cursor).toBeUndefined();
    });

    it('accepts valid limit and cursor', async () => {
      const dto = plainToInstance(TimelineQuery, {
        limit: '50',
        cursor: 'abc',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
      expect(dto.limit).toBe(50);
    });

    it('rejects out-of-range limit and overly long cursor', async () => {
      const zero = await validate(plainToInstance(TimelineQuery, { limit: '0' }));
      expect(zero.some((e) => e.property === 'limit')).toBe(true);

      const over = await validate(plainToInstance(TimelineQuery, { limit: '51' }));
      expect(over.some((e) => e.property === 'limit')).toBe(true);

      const longCursor = await validate(
        plainToInstance(TimelineQuery, { cursor: 'x'.repeat(301) }),
      );
      expect(longCursor.some((e) => e.property === 'cursor')).toBe(true);
    });
  });

  describe('controller delegation', () => {
    it('delegates patientTimeline to MedicalBooksService and exposes expected route path', async () => {
      const books = {
        patientTimeline: jest
          .fn()
          .mockResolvedValue({ items: [], nextCursor: null }),
      };
      const controller = new MedicalBooksController(books as any, {} as any);
      const actor = { id: 'rep-1', role: 'FAMILY_REP' } as any;

      const res = await (controller as any).patientTimeline(
        { user: actor },
        'fam-1',
        'pat-1',
        { limit: 20, cursor: 'c' },
      );

      expect(books.patientTimeline).toHaveBeenCalledWith(
        actor,
        'fam-1',
        'pat-1',
        { limit: 20, cursor: 'c' },
      );
      expect(res).toEqual({ items: [], nextCursor: null });
      expect(
        Reflect.getMetadata(
          'path',
          (MedicalBooksController.prototype as any).patientTimeline,
        ),
      ).toBe('families/:familyId/patients/:patientId/timeline');
    });
  });
});
