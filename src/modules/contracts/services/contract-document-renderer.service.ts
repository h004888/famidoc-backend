import { Injectable } from '@nestjs/common';
import type { SignerRole } from '@prisma/client';

export interface RenderedSignature {
  role: SignerRole;
  roleTitle: string;
  signerName: string;
  signerUserId: string;
  signedAt: Date;
  signedAtFormatted: string;
  signatureHash: string;
  signatureHashShort: string;
  termsHash: string;
  termsHashShort: string;
  ipAddress: string;
}

export interface RenderedContractDocument {
  contractId: string;
  contractNumber: string;
  termsHash: string;
  renderedHtml: string;
  signatures: RenderedSignature[];
}

@Injectable()
export class ContractDocumentRendererService {
  formatVietnamDateTime(date: Date | string): string {
    const d = new Date(date);
    const parts = new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);
    return `${parts} (+07:00)`;
  }

  shortenHash(hash: string, head = 8, tail = 8): string {
    if (!hash || hash.length <= head + tail) return hash || '';
    return `${hash.slice(0, head)}...${hash.slice(-tail)}`;
  }

  getRoleTitle(role: SignerRole | string): string {
    switch (role) {
      case 'FAMILY_REP':
        return 'Bên A - Đại diện Hộ gia đình';
      case 'HEALTHCARE_FACILITY':
        return 'Bên B - Cơ sở Y tế Đối tác';
      case 'ASSIGNED_DOCTOR':
        return 'Bên C - Bác sĩ Gia đình Phụ trách';
      case 'ADMIN':
        return 'Bên D - Đại diện Nền tảng FamiDoc';
      default:
        return String(role);
    }
  }

  renderSignatures(signatures: any[]): RenderedSignature[] {
    return (signatures || []).map((sig) => {
      const role = sig.signerRole as SignerRole;
      return {
        role,
        roleTitle: this.getRoleTitle(role),
        signerName: sig.signerName || sig.signerUserId,
        signerUserId: sig.signerUserId,
        signedAt: sig.signedAt,
        signedAtFormatted: this.formatVietnamDateTime(sig.signedAt),
        signatureHash: sig.signatureHash,
        signatureHashShort: this.shortenHash(sig.signatureHash),
        termsHash: sig.termsHash,
        termsHashShort: this.shortenHash(sig.termsHash),
        ipAddress: sig.ipAddress,
      };
    });
  }

  renderHtml(contract: any, signatures: any[]): string {
    const formattedSignatures = this.renderSignatures(signatures);
    const termsHash =
      contract.termsHash ||
      signatures?.[0]?.termsHash ||
      'CHƯA XÁC ĐỊNH';
    const termsHashShort = this.shortenHash(termsHash);

    const familyName =
      contract.familyUnit?.familyName ||
      contract.familyUnit?.familyCode ||
      contract.familyId;
    const facilityName =
      contract.facility?.facilityName || contract.facilityId;
    const doctorName =
      contract.doctor?.doctorName || contract.doctorId || 'Chưa phân công';
    const packageName =
      contract.servicePackage?.packageName ||
      contract.billingSnapshot?.packageName ||
      'Gói chăm sóc y tế gia đình';

    const membersHtml = (contract.members || [])
      .map((m: any, index: number) => {
        const p = m.patient || {};
        const dob = p.dateOfBirth
          ? new Date(p.dateOfBirth).toLocaleDateString('vi-VN')
          : 'N/A';
        return `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${index + 1}</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: 500;">${p.fullName || 'Thành viên'}</td>
            <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${dob}</td>
            <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${p.gender || 'N/A'}</td>
            <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${p.relationshipToHead || 'N/A'}</td>
          </tr>
        `;
      })
      .join('');

    const signaturesHtml = formattedSignatures
      .map((sig) => {
        return `
          <tr style="background-color: #fafafa;">
            <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">${sig.roleTitle} (${sig.role})</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${sig.signerName}</td>
            <td style="padding: 10px; border: 1px solid #ddd; font-size: 13px;">${sig.signedAtFormatted}</td>
            <td style="padding: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 12px;" title="${sig.signatureHash}">${sig.signatureHashShort}</td>
            <td style="padding: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 12px;">${sig.ipAddress}</td>
          </tr>
        `;
      })
      .join('');

    return `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Hợp đồng Dịch vụ Y tế - ${contract.contractNumber}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 40px; }
    h1 { text-align: center; color: #1a365d; text-transform: uppercase; margin-bottom: 5px; }
    .subtitle { text-align: center; font-size: 14px; color: #718096; margin-bottom: 30px; }
    .section-title { font-size: 16px; font-weight: bold; color: #2b6cb0; border-bottom: 2px solid #e2e8f0; padding-bottom: 5px; margin-top: 25px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 15px 0; }
    .info-box { background: #f7fafc; padding: 12px; border-radius: 6px; border: 1px solid #edf2f7; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; background: #ebf8ff; color: #2b6cb0; }
    .footer { margin-top: 40px; font-size: 12px; color: #a0aec0; text-align: center; }
  </style>
</head>
<body>
  <h1>HỢP ĐỒNG DỊCH VỤ CHĂM SÓC SỨC KHỎE GIA ĐÌNH 4 BÊN</h1>
  <div class="subtitle">Mã hợp đồng: <strong>${contract.contractNumber}</strong> | Trạng thái: <span class="badge">${contract.contractStatus}</span></div>

  <div class="section-title">1. CÁC BÊN THAM GIA HỢP ĐỒNG</div>
  <div class="info-grid">
    <div class="info-box">
      <strong>Bên A (Hộ gia đình):</strong> ${familyName}<br/>
      Mã định danh: ${contract.familyId}
    </div>
    <div class="info-box">
      <strong>Bên B (Cơ sở y tế):</strong> ${facilityName}<br/>
      Mã CSYT: ${contract.facilityId}
    </div>
    <div class="info-box">
      <strong>Bên C (Bác sĩ gia đình):</strong> ${doctorName}<br/>
      Chuyên khoa: ${contract.doctor?.specialty || 'Bác sĩ Y học gia đình'}
    </div>
    <div class="info-box">
      <strong>Bên D (Nền tảng):</strong> Công ty Cổ phần Công nghệ Y tế FamiDoc<br/>
      Cổng kết nối & Vận hành dịch vụ y tế từ xa
    </div>
  </div>

  <div class="section-title">2. GÓI DỊCH VỤ CHĂM SÓC SỨC KHỎE ÁP DỤNG</div>
  <p>
    <strong>Tên gói:</strong> ${packageName}<br/>
    <strong>Thời hạn hiệu lực:</strong> Từ ${this.formatVietnamDateTime(contract.startDate)} đến ${this.formatVietnamDateTime(contract.endDate)}<br/>
    <strong>Quyền lợi định mức:</strong> ${contract.remainingHomeVisits} lượt khám tại nhà, ${contract.remainingTelehealth} lượt tư vấn từ xa<br/>
    <strong>Giá trị hợp đồng:</strong> ${Number(contract.totalAmount).toLocaleString('vi-VN')} VND
  </p>

  <div class="section-title">3. DANH SÁCH THÀNH VIÊN GIA ĐÌNH ĐƯỢC BẢO TRỢ (${contract.members?.length || contract.memberCount || 0} người)</div>
  <table>
    <thead>
      <tr style="background-color: #edf2f7;">
        <th style="padding: 8px; border: 1px solid #ddd; width: 50px;">STT</th>
        <th style="padding: 8px; border: 1px solid #ddd;">Họ và Tên</th>
        <th style="padding: 8px; border: 1px solid #ddd;">Ngày sinh</th>
        <th style="padding: 8px; border: 1px solid #ddd;">Giới tính</th>
        <th style="padding: 8px; border: 1px solid #ddd;">Quan hệ với chủ hộ</th>
      </tr>
    </thead>
    <tbody>
      ${membersHtml || '<tr><td colspan="5" style="text-align: center; padding: 10px;">Chưa có danh sách thành viên</td></tr>'}
    </tbody>
  </table>

  <div class="section-title">4. ĐIỀU KHOẢN TOÀN VẸN & MÃ BẢO MẬT (TERMS HASH)</div>
  <p style="background: #edf2f7; padding: 10px; font-family: monospace; font-size: 13px; word-break: break-all; border-radius: 4px;">
    Mã hash bảo mật SHA-256: <strong>${termsHash}</strong> (Rút gọn: ${termsHashShort})
  </p>

  <div class="section-title">5. BẢNG CHỮ KÝ ĐIỆN TỬ 4 BÊN (DIGITAL SIGNATURES)</div>
  <table>
    <thead>
      <tr style="background-color: #edf2f7;">
        <th style="padding: 10px; border: 1px solid #ddd;">Vai trò ký số</th>
        <th style="padding: 10px; border: 1px solid #ddd;">Đại diện ký</th>
        <th style="padding: 10px; border: 1px solid #ddd;">Thời gian ký (GMT+7)</th>
        <th style="padding: 10px; border: 1px solid #ddd;">Mã chữ ký (SHA-256)</th>
        <th style="padding: 10px; border: 1px solid #ddd;">Địa chỉ IP</th>
      </tr>
    </thead>
    <tbody>
      ${signaturesHtml || '<tr><td colspan="5" style="text-align: center; padding: 15px;">Chưa có chữ ký điện tử nào</td></tr>'}
    </tbody>
  </table>

  <div class="footer">
    Văn bản hợp đồng điện tử được xác thực và bảo chứng bởi FamiDoc Platform. Ngày kết xuất: ${this.formatVietnamDateTime(new Date())}
  </div>
</body>
</html>
    `.trim();
  }
}
