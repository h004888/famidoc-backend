import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import {
  ResolveComplaintDto,
  SubmitIncidentComplaintDto,
} from '../dtos/complaint.dto';
import {
  COMPLAINTS_SERVICE_TOKEN,
  type IComplaintsService,
} from '../services/interfaces/complaints.service.interface';
@Controller('api/v1/complaints')
@UseGuards(JwtAuthGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class ComplaintsController {
  constructor(
    @Inject(COMPLAINTS_SERVICE_TOKEN)
    private readonly service: IComplaintsService,
  ) {}
  @Post() submitIncidentComplaint(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SubmitIncidentComplaintDto,
  ) {
    return this.service.submitIncidentComplaint(req.user, dto);
  }
  @Get(':id') getComplaintDetail(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.getComplaintDetail(req.user, id);
  }
  @Patch(':id/resolve') resolveComplaint(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ResolveComplaintDto,
  ) {
    return this.service.resolveComplaint(req.user, id, dto);
  }
}
