import { Prisma, type DoctorReview } from '@prisma/client';
export const REVIEW_ENCOUNTER_INCLUDE = {
  contract: { select: { familyId: true } },
  doctor: true,
} as const;
export type ReviewEncounter = Prisma.EncounterGetPayload<{
  include: typeof REVIEW_ENCOUNTER_INCLUDE;
}>;
export const REVIEWS_REPOSITORY_TOKEN = Symbol('IReviewsRepository');
export interface ReviewsSession {
  findEncounter(id: string): Promise<ReviewEncounter | null>;
  findReview(encounterId: string): Promise<DoctorReview | null>;
  createReview(
    data: Prisma.DoctorReviewUncheckedCreateInput,
  ): Promise<DoctorReview>;
  updateDoctorRating(doctorId: string): Promise<void>;
  recordReviewAudit(
    actorId: string,
    reviewId: string,
    doctorUserId: string,
  ): Promise<void>;
}
export interface IReviewsRepository {
  transaction<T>(work: (session: ReviewsSession) => Promise<T>): Promise<T>;
}
