import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FacilityOverviewDoctorsDto {
  @ApiProperty({ example: 12 })
  total!: number;

  @ApiProperty({ example: 10 })
  active!: number;

  @ApiProperty({ example: 2 })
  pending!: number;

  @ApiProperty({ example: 18 })
  activePanelCount!: number;

  @ApiProperty({ example: 50 })
  maxPanelCapacity!: number;

  @ApiProperty({ example: 36 })
  panelUtilizationPercent!: number;
}

export class FacilityOverviewEncountersByChannelDto {
  @ApiProperty({ example: 10 })
  HOME_VISIT!: number;

  @ApiProperty({ example: 8 })
  TELEHEALTH!: number;

  @ApiProperty({ example: 4 })
  FACILITY_VISIT!: number;
}

export class FacilityOverviewEncountersDto {
  @ApiProperty({ example: 11 })
  month!: number;

  @ApiProperty({ example: 2026 })
  year!: number;

  @ApiProperty({ example: 22 })
  total!: number;

  @ApiProperty({ example: 15 })
  completed!: number;

  @ApiProperty({ example: 1 })
  inProgress!: number;

  @ApiProperty({ example: 4 })
  confirmed!: number;

  @ApiProperty({ example: 1 })
  requested!: number;

  @ApiProperty({ example: 1 })
  cancelled!: number;

  @ApiProperty({ example: 68 })
  completionRatePercent!: number;

  @ApiProperty({ type: () => FacilityOverviewEncountersByChannelDto })
  byChannel!: FacilityOverviewEncountersByChannelDto;
}

export class FacilityOverviewRevenueDto {
  @ApiProperty({ example: 11 })
  month!: number;

  @ApiProperty({ example: 2026 })
  year!: number;

  @ApiProperty({ example: 12000000 })
  grossVnd!: number;

  @ApiProperty({ example: 10200000 })
  facilityShareVnd!: number;

  @ApiProperty({ example: 1800000 })
  platformFeeVnd!: number;

  @ApiProperty({ example: 4 })
  invoiceCount!: number;

  @ApiProperty({ example: 85 })
  facilitySharePercent!: number;

  @ApiProperty({ example: 15 })
  platformSharePercent!: number;

  @ApiPropertyOptional({ example: 'B2B-2026-001', nullable: true })
  activeB2bContractCode!: string | null;

  @ApiPropertyOptional({ example: '2027-11-20', nullable: true })
  activeB2bValidTo!: string | null;
}

export class FacilityOverviewRecentEncounterDto {
  @ApiProperty({ example: 'enc-uuid-1' })
  id!: string;

  @ApiProperty({ example: 'TELEHEALTH' })
  encounterType!: string;

  @ApiProperty({ example: 'CONFIRMED' })
  encounterStatus!: string;

  @ApiProperty({ example: '2026-11-22' })
  scheduledDate!: string;

  @ApiProperty({ example: '09:30' })
  scheduledTime!: string;

  @ApiProperty({ example: 'BS. Nguyễn Văn An' })
  doctorName!: string;

  @ApiProperty({ example: 'Y học gia đình' })
  specialty!: string;

  @ApiProperty({ type: [String], example: ['Lê Văn Nam'] })
  patientNames!: string[];

  @ApiPropertyOptional({ example: 'HD-2026-0001', nullable: true })
  contractNumber!: string | null;
}

export class FacilityOverviewResponseDto {
  @ApiProperty({ type: () => FacilityOverviewDoctorsDto })
  doctors!: FacilityOverviewDoctorsDto;

  @ApiProperty({ type: () => FacilityOverviewEncountersDto })
  encounters!: FacilityOverviewEncountersDto;

  @ApiProperty({ type: () => FacilityOverviewRevenueDto })
  revenue!: FacilityOverviewRevenueDto;

  @ApiProperty({ type: () => [FacilityOverviewRecentEncounterDto] })
  recentEncounters!: FacilityOverviewRecentEncounterDto[];

  @ApiProperty({ example: 0 })
  pendingRescheduleCount!: number;
}
