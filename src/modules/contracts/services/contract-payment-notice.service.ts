import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  renderFamiDocEmailLayout,
  renderKeyValueRows,
} from '../../../core/mailer/templates/famidoc-email-layout';

interface MailerService {
  sendMail(options: Record<string, unknown>): Promise<unknown>;
}

// Chỉ đọc phần dữ liệu cần cho email; snapshot do backend tạo lúc ký nên giá ở đây là giá đã chốt.
interface ContractBillingSnapshot {
  package?: { name?: string };
  pricing?: { totalPriceVnd?: number };
}

const PAYMENT_NOTICE_SUBJECT =
  'FamiDoc - Hợp đồng chăm sóc gia đình đã đủ 4 chữ ký, vui lòng thanh toán';

/**
 * Gửi email nhắc đại diện hộ gia đình thanh toán ngay sau khi hợp đồng 4 bên đủ chữ ký.
 *
 * Chạy NGOÀI transaction ký hợp đồng: transaction có thể thử lại và không được chứa I/O.
 * Mọi lỗi ở đây chỉ ghi log, không được làm hỏng kết quả ký số đã commit.
 */
@Injectable()
export class ContractPaymentNoticeService {
  private readonly logger = new Logger(ContractPaymentNoticeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject('MAILER_SERVICE')
    private readonly mailerService?: MailerService,
  ) {}

  async sendPaymentNotice(contractId: string): Promise<void> {
    try {
      const appUrl = process.env.APP_PUBLIC_URL?.trim();
      if (!appUrl) {
        this.logger.warn(
          `APP_PUBLIC_URL chưa được cấu hình; không gửi email thông báo thanh toán cho hợp đồng ${contractId}`,
        );
        return;
      }

      if (!this.mailerService?.sendMail) {
        this.logger.warn(
          `Không có dịch vụ gửi mail; bỏ qua email thông báo thanh toán cho hợp đồng ${contractId}`,
        );
        return;
      }

      const contract = await this.prisma.medicalContract.findUnique({
        where: { id: contractId },
        select: {
          id: true,
          contractNumber: true,
          totalAmount: true,
          billingSnapshot: true,
          startDate: true,
          endDate: true,
          familyUnit: {
            select: {
              representativeUser: {
                select: { email: true, fullName: true },
              },
            },
          },
          doctor: { select: { user: { select: { fullName: true } } } },
          servicePackage: { select: { packageName: true } },
        },
      });

      if (!contract) {
        this.logger.warn(
          `Không tìm thấy hợp đồng ${contractId}; bỏ qua email thông báo thanh toán`,
        );
        return;
      }

      const representative = contract.familyUnit?.representativeUser;
      const email = representative?.email?.trim();
      if (!email) {
        this.logger.warn(
          `Đại diện hộ gia đình của hợp đồng ${contractId} không có email; bỏ qua gửi thông báo thanh toán`,
        );
        return;
      }

      const snapshot = (contract.billingSnapshot ??
        {}) as ContractBillingSnapshot;
      const packageName =
        snapshot.package?.name ??
        contract.servicePackage?.packageName ??
        'Gói chăm sóc sức khỏe gia đình';
      const amountVnd =
        snapshot.pricing?.totalPriceVnd ?? Number(contract.totalAmount);
      const amountLabel = `${new Intl.NumberFormat('vi-VN').format(amountVnd)} đ`;
      const paymentUrl = `${appUrl.replace(/\/+$/, '')}/booking/tracking?contractId=${contract.id}`;
      const representativeName = representative.fullName ?? 'Quý khách';
      const doctorName = contract.doctor?.user?.fullName;
      const termLabel = `${this.formatDate(contract.startDate)} - ${this.formatDate(contract.endDate)}`;

      await this.mailerService.sendMail({
        to: email,
        subject: PAYMENT_NOTICE_SUBJECT,
        text: this.buildText({
          representativeName,
          packageName,
          amountLabel,
          contractNumber: contract.contractNumber,
          doctorName,
          termLabel,
          paymentUrl,
        }),
        html: this.buildHtml({
          representativeName,
          packageName,
          amountLabel,
          contractNumber: contract.contractNumber,
          doctorName,
          termLabel,
          paymentUrl,
        }),
      });
    } catch (error) {
      this.logger.error(
        `Gửi email thông báo thanh toán cho hợp đồng ${contractId} thất bại: ${(error as Error)?.message ?? error}`,
      );
    }
  }

  private formatDate(value: Date): string {
    const day = String(value.getUTCDate()).padStart(2, '0');
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${value.getUTCFullYear()}`;
  }

  private buildText(data: PaymentNoticeData): string {
    return [
      `Kính gửi ${data.representativeName},`,
      '',
      `Hợp đồng dịch vụ chăm sóc sức khỏe gia đình số ${data.contractNumber} đã được cả bốn bên ký số thành công.`,
      '',
      `Gói dịch vụ: ${data.packageName}`,
      `Số tiền cần thanh toán: ${data.amountLabel}`,
      `Kỳ hạn hợp đồng: ${data.termLabel}`,
      data.doctorName ? `Bác sĩ phụ trách: ${data.doctorName}` : null,
      '',
      'Vui lòng mở đường dẫn sau để xem tiến độ ký kết và thanh toán gói dịch vụ:',
      data.paymentUrl,
      '',
      'Trân trọng,',
      'Đội ngũ FamiDoc',
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  }

  private buildHtml(data: PaymentNoticeData): string {
    const rows = [
      { label: 'Mã hợp đồng', value: data.contractNumber },
      { label: 'Gói dịch vụ', value: data.packageName },
      {
        label: 'Số tiền cần thanh toán',
        value: data.amountLabel,
        highlight: true,
      },
      { label: 'Kỳ hạn hợp đồng', value: data.termLabel },
      ...(data.doctorName
        ? [{ label: 'Bác sĩ phụ trách', value: data.doctorName }]
        : []),
    ];

    return renderFamiDocEmailLayout({
      preheader: `Hợp đồng ${data.contractNumber} đã đủ 4 chữ ký. Số tiền cần thanh toán: ${data.amountLabel}.`,
      badgeLabel: 'Chờ thanh toán',
      tone: 'action',
      title: 'Hợp đồng đã đủ 4 chữ ký',
      greeting: `Kính gửi ${data.representativeName},`,
      intro: `Hợp đồng dịch vụ chăm sóc sức khỏe gia đình số ${data.contractNumber} đã được cả bốn bên ký số thành công.`,
      bodyHtml: renderKeyValueRows(rows, 'action'),
      cta: {
        label: 'Thanh toán gói dịch vụ',
        url: data.paymentUrl,
      },
    });
  }
}

interface PaymentNoticeData {
  representativeName: string;
  packageName: string;
  amountLabel: string;
  contractNumber: string;
  doctorName?: string;
  termLabel: string;
  paymentUrl: string;
}
