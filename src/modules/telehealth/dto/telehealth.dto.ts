import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReportTelemetryDto {
  @ApiPropertyOptional({ enum: ['EXCELLENT', 'GOOD', 'POOR', 'LOST'] })
  @IsOptional()
  @IsIn(['EXCELLENT', 'GOOD', 'POOR', 'LOST'])
  networkQualityScore?: 'EXCELLENT' | 'GOOD' | 'POOR' | 'LOST';

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isFallbackChat?: boolean;
}

export class CreateTelehealthMessageDto {
  @ApiProperty({ description: 'Nội dung tin nhắn y tế (1–2000 ký tự)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content!: string;
}

export class TelehealthSessionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  encounterId!: string;

  @ApiProperty()
  roomSid!: string;

  @ApiPropertyOptional({ nullable: true })
  startedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  endedAt!: Date | null;

  @ApiProperty()
  durationSeconds!: number;

  @ApiPropertyOptional({ nullable: true })
  networkQualityScore!: string | null;

  @ApiProperty()
  isFallbackChat!: boolean;
}

export class IssueTelehealthTokenResponseDto {
  @ApiProperty()
  token!: string;

  @ApiProperty()
  url!: string;

  @ApiProperty()
  roomName!: string;

  @ApiProperty()
  participantIdentity!: string;

  @ApiProperty({ type: TelehealthSessionResponseDto })
  session!: TelehealthSessionResponseDto;
}
