import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateTreatedCaseDto } from '../dtos/create-treated-case.dto';
import { UpdateTreatedCaseDto } from '../dtos/update-treated-case.dto';
import {
  CreatePlatformCareItemDto,
  PlatformCareCategoryValue,
} from '../dtos/create-platform-care-item.dto';
import { UpdatePlatformCareItemDto } from '../dtos/update-platform-care-item.dto';

@Injectable()
export class PlatformContentService {
  constructor(private readonly prisma: PrismaService) {}

  async listTreatedCases(doctorId: string) {
    await this.ensureDoctorExists(doctorId);

    return this.prisma.doctorTreatedCase.findMany({
      where: { doctorId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createTreatedCase(doctorId: string, dto: CreateTreatedCaseDto) {
    await this.ensureDoctorExists(doctorId);

    return this.prisma.doctorTreatedCase.create({
      data: {
        doctorId,
        summary: dto.summary,
        status: 'PENDING',
      },
    });
  }

  async updateTreatedCase(
    doctorId: string,
    id: string,
    dto: UpdateTreatedCaseDto,
  ) {
    const existing = await this.findTreatedCase(doctorId, id);
    const summaryChanged =
      dto.summary !== undefined && dto.summary !== existing.summary;

    return this.prisma.doctorTreatedCase.update({
      where: { id },
      data: {
        ...(dto.summary !== undefined ? { summary: dto.summary } : {}),
        ...(summaryChanged
          ? {
              status: 'PENDING',
              approvedBy: null,
              approvedAt: null,
              rejectionReason: null,
            }
          : {}),
      },
    });
  }

  async approveTreatedCase(doctorId: string, id: string, reviewerId: string) {
    await this.findTreatedCase(doctorId, id);

    return this.prisma.doctorTreatedCase.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedBy: reviewerId,
        approvedAt: new Date(),
        rejectionReason: null,
      },
    });
  }

  async rejectTreatedCase(
    doctorId: string,
    id: string,
    reviewerId: string,
    reason: string,
  ) {
    await this.findTreatedCase(doctorId, id);

    return this.prisma.doctorTreatedCase.update({
      where: { id },
      data: {
        status: 'REJECTED',
        approvedBy: reviewerId,
        approvedAt: null,
        rejectionReason: reason,
      },
    });
  }

  listCareItems() {
    return this.prisma.platformCareItem.findMany({
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async createCareItem(dto: CreatePlatformCareItemDto) {
    const sortOrder =
      dto.sortOrder !== undefined
        ? dto.sortOrder
        : await this.nextCareSortOrder(dto.category);

    return this.prisma.platformCareItem.create({
      data: {
        category: dto.category,
        title: dto.title,
        description: dto.description ?? '',
        icon: dto.icon ?? null,
        sortOrder,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateCareItem(id: string, dto: UpdatePlatformCareItemDto) {
    await this.findCareItem(id);

    return this.prisma.platformCareItem.update({
      where: { id },
      data: {
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async deactivateCareItem(id: string) {
    await this.findCareItem(id);

    return this.prisma.platformCareItem.update({
      where: { id },
      data: { isActive: false },
    });
  }

  private async ensureDoctorExists(doctorId: string) {
    const doctor = await this.prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { id: true },
    });

    if (!doctor) {
      throw new NotFoundException('Không tìm thấy bác sĩ');
    }

    return doctor;
  }

  private async findTreatedCase(doctorId: string, id: string) {
    const item = await this.prisma.doctorTreatedCase.findFirst({
      where: { id, doctorId },
    });

    if (!item) {
      throw new NotFoundException('Không tìm thấy ca bệnh tiêu biểu');
    }

    return item;
  }

  private async findCareItem(id: string) {
    const item = await this.prisma.platformCareItem.findUnique({
      where: { id },
    });

    if (!item) {
      throw new NotFoundException('Không tìm thấy nội dung chăm sóc');
    }

    return item;
  }

  private async nextCareSortOrder(category: PlatformCareCategoryValue) {
    const last = await this.prisma.platformCareItem.findFirst({
      where: { category },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    return (last?.sortOrder ?? 0) + 1;
  }
}
