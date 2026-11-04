import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/database/prisma.service';
import { serializable } from '../../../../core/database/prisma-transaction';
import { writeBusinessAudit } from '../../../../core/business/business-helpers';
import {
  REVIEW_ENCOUNTER_INCLUDE,
  type IReviewsRepository,
  type ReviewsSession,
} from '../interfaces/reviews.repository.interface';
@Injectable()
export class ReviewsRepositoryImpl implements IReviewsRepository {
  constructor(private readonly prisma: PrismaService) {}
  transaction<T>(work: (session: ReviewsSession) => Promise<T>) {
    return serializable(this.prisma, (tx) =>
      work(new PrismaReviewsSession(tx)),
    );
  }
}
class PrismaReviewsSession implements ReviewsSession {
  constructor(private readonly tx: Prisma.TransactionClient) {}
  findEncounter(id: string) {
    return this.tx.encounter.findUnique({
      where: { id },
      include: REVIEW_ENCOUNTER_INCLUDE,
    });
  }
  findReview(encounterId: string) {
    return this.tx.doctorReview.findUnique({ where: { encounterId } });
  }
  createReview(data: Prisma.DoctorReviewUncheckedCreateInput) {
    return this.tx.doctorReview.create({ data });
  }
  async updateDoctorRating(doctorId: string) {
    // Tính lại từ các đánh giá đã lưu. Không lấy điểm trung bình do client gửi.
    const scores = await this.tx.doctorReview.aggregate({
      where: { doctorId },
      _avg: { ratingStars: true },
      _count: true,
    });
    await this.tx.doctor.update({
      where: { id: doctorId },
      data: {
        ratingAvg: scores._avg.ratingStars ?? 5,
        totalReviews: scores._count,
      },
    });
  }
  async recordReviewAudit(
    actorId: string,
    reviewId: string,
    doctorUserId: string,
  ) {
    await writeBusinessAudit(
      this.tx,
      actorId,
      'SUBMIT_DOCTOR_REVIEW',
      'doctor_reviews',
      reviewId,
    );
    await this.tx.notification.create({
      data: {
        userId: doctorUserId,
        title: 'Có đánh giá mới',
        content: 'Gia đình đã gửi đánh giá sau buổi khám.',
        type: 'DOCTOR_REVIEW',
        referenceId: reviewId,
      },
    });
  }
}
