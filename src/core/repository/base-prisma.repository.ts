import { IBaseRepository } from './base.repository.interface';

/** Phần tối thiểu của Prisma delegate (prisma.user, prisma.order, ...) mà repository cần. */
export interface PrismaModelDelegate<T> {
  findMany(args?: any): Promise<T[]>;
  findUnique(args: any): Promise<T | null>;
  create(args: any): Promise<T>;
  update(args: any): Promise<T>;
  delete(args: any): Promise<T>;
}

export abstract class BasePrismaRepository<T, CreateDto, UpdateDto, Id = string>
  implements IBaseRepository<T, CreateDto, UpdateDto, Id>
{
  protected constructor(protected readonly delegate: PrismaModelDelegate<T>) {}

  findAll(): Promise<T[]> {
    return this.delegate.findMany();
  }

  findById(id: Id): Promise<T | null> {
    return this.delegate.findUnique({ where: { id } });
  }

  create(data: CreateDto): Promise<T> {
    return this.delegate.create({ data });
  }

  update(id: Id, data: UpdateDto): Promise<T> {
    return this.delegate.update({ where: { id }, data });
  }

  delete(id: Id): Promise<T> {
    return this.delegate.delete({ where: { id } });
  }
}
