import { PaginationHelper, CursorHelper } from '../pagination.helper';
import { PaginationQueryDto } from '../../dtos/pagination-query.dto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

describe('PaginationHelper and CursorHelper', () => {
  describe('PaginationHelper.createOffsetPagination', () => {
    it('nên tính toán đúng siêu dữ liệu phân trang cho trang đầu tiên', () => {
      const meta = PaginationHelper.createOffsetPagination({
        totalRecords: 150,
        page: 1,
        pageSize: 20,
      });

      expect(meta).toEqual({
        page: 1,
        pageSize: 20,
        totalRecords: 150,
        totalPages: 8,
        hasNextPage: true,
        hasPreviousPage: false,
      });
    });

    it('nên tính toán đúng cho trang cuối cùng', () => {
      const meta = PaginationHelper.createOffsetPagination({
        totalRecords: 150,
        page: 8,
        pageSize: 20,
      });

      expect(meta).toEqual({
        page: 8,
        pageSize: 20,
        totalRecords: 150,
        totalPages: 8,
        hasNextPage: false,
        hasPreviousPage: true,
      });
    });

    it('nên trả về 0 totalPages và hasNext/hasPrev false khi không có dữ liệu', () => {
      const meta = PaginationHelper.createOffsetPagination({
        totalRecords: 0,
        page: 1,
        pageSize: 20,
      });

      expect(meta).toEqual({
        page: 1,
        pageSize: 20,
        totalRecords: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });

    it('nên tự động chuẩn hóa giá trị biên nếu page hoặc pageSize nhỏ hơn 1', () => {
      const meta = PaginationHelper.createOffsetPagination({
        totalRecords: 50,
        page: -5,
        pageSize: 0,
      });

      expect(meta.page).toBe(1);
      expect(meta.pageSize).toBe(1);
    });
  });

  describe('CursorHelper', () => {
    it('nên mã hóa và giải mã cursor object an toàn', () => {
      const payload = { id: 'ord_1001', createdAt: '2026-11-10T08:30:00.000Z' };
      const cursor = CursorHelper.encode(payload);

      expect(typeof cursor).toBe('string');
      expect(cursor).not.toContain('+');
      expect(cursor).not.toContain('/');

      const decoded = CursorHelper.decode<typeof payload>(cursor);
      expect(decoded).toEqual(payload);
    });

    it('nên trả về null khi giải mã chuỗi cursor không hợp lệ', () => {
      expect(CursorHelper.decode('invalid!!!cursor')).toBeNull();
      expect(CursorHelper.decode('')).toBeNull();
    });
  });

  describe('PaginationQueryDto', () => {
    it('nên gán giá trị mặc định page=1, pageSize=20 khi không truyền tham số', async () => {
      const dto = plainToInstance(PaginationQueryDto, {});
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.page).toBe(1);
      expect(dto.pageSize).toBe(20);
    });

    it('nên bắt lỗi khi pageSize vượt quá 100 hoặc page nhỏ hơn 1', async () => {
      const dto = plainToInstance(PaginationQueryDto, {
        page: 0,
        pageSize: 200,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
