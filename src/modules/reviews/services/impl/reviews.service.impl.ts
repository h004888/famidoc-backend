import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  REVIEWS_REPOSITORY_TOKEN,
  type IReviewsRepository,
} from '../../repositories/interfaces/reviews.repository.interface';
import type { IReviewsService } from '../interfaces/reviews.service.interface';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import type { SubmitDoctorReviewDto } from '../../dtos/submit-doctor-review.dto';
@Injectable()
export class ReviewsServiceImpl implements IReviewsService {
  constructor(
    @Inject(REVIEWS_REPOSITORY_TOKEN)
    private readonly repository: IReviewsRepository,
  ) {}
  submitDoctorReview(actor: AuthenticatedUser, dto: SubmitDoctorReviewDto) {
    if (actor.role !== 'FAMILY_REP')
      throw new ForbiddenException(
        'Only the family representative can submit reviews',
      );
    return this.repository.transaction(async (session) => {
      const encounter = await session.findEncounter(dto.encounterId);
      if (!encounter || encounter.contract.familyId !== actor.familyUnitId)
        throw new NotFoundException('Encounter not found');
      // Gia đình chỉ đánh giá sau buổi khám đã hoàn thành, mỗi buổi đúng một lần.
      if (encounter.encounterStatus !== 'COMPLETED')
        throw new ConflictException('The encounter has not been completed');
      if (await session.findReview(encounter.id))
        throw new ConflictException('This encounter already has a review');
      const review = await session.createReview({
        encounterId: encounter.id,
        familyId: encounter.contract.familyId,
        doctorId: encounter.doctorId,
        ratingStars: dto.ratingStars,
        reviewComment: dto.reviewComment,
      });
      await session.updateDoctorRating(encounter.doctorId);
      await session.recordReviewAudit(
        actor.id,
        review.id,
        encounter.doctor.userId,
      );
      return review;
    });
  }
}
