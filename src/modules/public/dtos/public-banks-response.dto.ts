import { ApiProperty } from '@nestjs/swagger';

export class PublicBankItemDto {
  @ApiProperty({ example: 43 })
  id!: number;

  @ApiProperty({ example: 'Ngân hàng TMCP Ngoại thương Việt Nam' })
  name!: string;

  @ApiProperty({ example: 'VCB' })
  code!: string;

  @ApiProperty({ example: '970436' })
  bin!: string;

  @ApiProperty({ example: 'Vietcombank' })
  shortName!: string;

  @ApiProperty({ example: 'https://api.vietqr.io/img/VCB.png' })
  logo!: string;

  @ApiProperty({ example: 1 })
  transferSupported!: number;

  @ApiProperty({ example: 1 })
  lookupSupported!: number;
}

export class PublicBanksResponseDto {
  @ApiProperty({ enum: ['vietqr', 'cache', 'fallback'], example: 'vietqr' })
  source!: 'vietqr' | 'cache' | 'fallback';

  @ApiProperty({ example: '2026-11-18T14:00:00.000Z' })
  updatedAt!: string;

  @ApiProperty({ type: [PublicBankItemDto] })
  items!: PublicBankItemDto[];
}
