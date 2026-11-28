import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../core/auth/roles.guard';
import { SearchIcd10Dto } from './dtos/search-icd10.dto';
import { Icd10Service } from './icd10.service';

@ApiTags('ICD-10')
@ApiBearerAuth('JWT-auth')
@Controller('api/v1/icd10')
@Roles('DOCTOR')
@UseGuards(JwtAuthGuard, RolesGuard)
export class Icd10Controller {
  constructor(private readonly icd10Service: Icd10Service) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Tra cứu mã bệnh ICD-10 theo mã hoặc tên tiếng Việt' })
  search(@Query() query: SearchIcd10Dto) {
    return this.icd10Service.search(query);
  }
}
