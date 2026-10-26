import { BasePrismaRepository, PrismaModelDelegate } from '../repository/base-prisma.repository';

type Row = { id: string; name: string };

class TestRepository extends BasePrismaRepository<Row, { name: string }, { name?: string }> {
  constructor(delegate: PrismaModelDelegate<Row>) {
    super(delegate);
  }
}

describe('BasePrismaRepository', () => {
  const row: Row = { id: 'id-1', name: 'sample' };
  let delegate: jest.Mocked<PrismaModelDelegate<Row>>;
  let repo: TestRepository;

  beforeEach(() => {
    delegate = {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as jest.Mocked<PrismaModelDelegate<Row>>;
    repo = new TestRepository(delegate);
  });

  it('findAll gọi delegate.findMany', async () => {
    delegate.findMany.mockResolvedValue([row]);
    await expect(repo.findAll()).resolves.toEqual([row]);
    expect(delegate.findMany).toHaveBeenCalledTimes(1);
  });

  it('findById gọi findUnique với where.id và trả null khi không có', async () => {
    delegate.findUnique.mockResolvedValue(null);
    await expect(repo.findById('x')).resolves.toBeNull();
    expect(delegate.findUnique).toHaveBeenCalledWith({ where: { id: 'x' } });
  });

  it('create gọi delegate.create với data', async () => {
    delegate.create.mockResolvedValue(row);
    await expect(repo.create({ name: 'sample' })).resolves.toEqual(row);
    expect(delegate.create).toHaveBeenCalledWith({ data: { name: 'sample' } });
  });

  it('update gọi delegate.update với where.id và data', async () => {
    delegate.update.mockResolvedValue(row);
    await repo.update('id-1', { name: 'new' });
    expect(delegate.update).toHaveBeenCalledWith({ where: { id: 'id-1' }, data: { name: 'new' } });
  });

  it('delete gọi delegate.delete với where.id', async () => {
    delegate.delete.mockResolvedValue(row);
    await repo.delete('id-1');
    expect(delegate.delete).toHaveBeenCalledWith({ where: { id: 'id-1' } });
  });
});
