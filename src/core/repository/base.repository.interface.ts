export interface IBaseRepository<T, CreateDto, UpdateDto, Id = string> {
  findAll(): Promise<T[]>;
  findById(id: Id): Promise<T | null>;
  create(data: CreateDto): Promise<T>;
  update(id: Id, data: UpdateDto): Promise<T>;
  delete(id: Id): Promise<T>;
}
