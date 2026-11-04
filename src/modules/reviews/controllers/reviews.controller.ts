import {
  Body,
  Controller,
  Inject,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { SubmitDoctorReviewDto } from '../dtos/submit-doctor-review.dto';
import {
  REVIEWS_SERVICE_TOKEN,
  type IReviewsService,
} from '../services/interfaces/reviews.service.interface';

@ApiTags('Reviews')
@ApiBearerAuth('JWT-auth')
@Controller('api/v1/reviews')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('FAMILY_REP')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class ReviewsController {
  constructor(
    @Inject(REVIEWS_SERVICE_TOKEN) private readonly service: IReviewsService,
  ) {}

  @Post('doctors')
  @ApiOperation({ summary: 'Người đại diện gia đình gửi đánh giá và nhận xét cho bác sĩ' })
  @ApiBody({ type: SubmitDoctorReviewDto })
  @ApiResponse({ status: 201, description: 'Gửi đánh giá bác sĩ thành công' })
  @ApiResponse({ status: 400, description: 'Dữ liệu đánh giá không hợp lệ hoặc không có quyền đánh giá' })
  submitDoctorReview(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SubmitDoctorReviewDto,
  ) {
    return this.service.submitDoctorReview(req.user, dto);
  }
}
