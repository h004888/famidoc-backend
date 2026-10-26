import { IsNotEmpty, IsString } from 'class-validator';

export class CreateAuthDto {
  // TODO: thay bằng các field thật của model Prisma `user` (theo kế hoạch)
  @IsString()
  @IsNotEmpty()
  name!: string;
}
