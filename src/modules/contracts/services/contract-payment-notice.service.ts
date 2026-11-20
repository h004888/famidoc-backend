import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

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
    const doctorLine = data.doctorName
      ? `<tr><td style="padding:6px 0;color:#475569;">Bác sĩ phụ trách</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">${this.escapeHtml(data.doctorName)}</td></tr>`
      : '';

    return `<!doctype html>
<html lang="vi">
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:28px;">
      <h1 style="margin:0 0 8px;font-size:18px;color:#2E37A4;">Hợp đồng đã đủ 4 chữ ký</h1>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#334155;">
        Kính gửi <strong>${this.escapeHtml(data.representativeName)}</strong>, hợp đồng dịch vụ chăm sóc sức khỏe gia đình
        số <strong>${this.escapeHtml(data.contractNumber)}</strong> đã được cả bốn bên ký số thành công.
      </p>
      <table style="width:100%;font-size:14px;border-collapse:collapse;margin-bottom:20px;">
        <tr><td style="padding:6px 0;color:#475569;">Gói dịch vụ</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">${this.escapeHtml(data.packageName)}</td></tr>
        <tr><td style="padding:6px 0;color:#475569;">Số tiền cần thanh toán</td><td style="padding:6px 0;color:#2E37A4;font-weight:700;font-size:16px;">${this.escapeHtml(data.amountLabel)}</td></tr>
        <tr><td style="padding:6px 0;color:#475569;">Kỳ hạn hợp đồng</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">${this.escapeHtml(data.termLabel)}</td></tr>
        ${doctorLine}
      </table>
      <a href="${this.escapeHtml(data.paymentUrl)}" style="display:inline-block;background:#2E37A4;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:12px;">
        Thanh toán gói dịch vụ
      </a>
      <p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#64748b;">
        Nếu nút trên không mở được, hãy sao chép đường dẫn sau vào trình duyệt:<br />
        <span style="word-break:break-all;">${this.escapeHtml(data.paymentUrl)}</span>
      </p>
      <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;">Trân trọng, Đội ngũ FamiDoc</p>
    </div>
  </body>
</html>`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
