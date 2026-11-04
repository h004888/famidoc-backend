import type { DoctorReview } from '@prisma/client';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import type { SubmitDoctorReviewDto } from '../../dtos/submit-doctor-review.dto';
export const REVIEWS_SERVICE_TOKEN = Symbol('IReviewsService');
export interface IReviewsService {
  submitDoctorReview(
    actor: AuthenticatedUser,
    dto: SubmitDoctorReviewDto,
  ): Promise<DoctorReview>;
}
