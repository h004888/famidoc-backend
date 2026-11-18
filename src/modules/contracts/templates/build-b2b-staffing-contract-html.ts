import { DOCUMENSO_SIGNATURE_MARKERS } from './documenso-contract-template.schema';
import {
  resolvePlatformLegalIdentity,
  type PlatformAdminSignerLike,
} from './platform-legal-identity';

export interface BuildB2bStaffingContractHtmlInput {
  contractNumber: string;
  createdAt?: Date | string;
  facilityName: string;
  facilityLicenseNumber: string;
  facilityLicenseIssuer?: string | null;
  facilityLicenseDate?: Date | string | null;
  facilityTaxCode: string;
  facilityAddress: string;
  facilityRepresentativeName: string;
  facilityEmail: string;
  facilityPhone: string;
  facilityHotline?: string | null;
  facilityBankName: string;
  facilityBankAccountNumber: string;
  facilityBankAccountHolder: string;
  platformCommissionRate: number;
  facilityRevenueRate: number;
  startDate: Date | string;
  endDate: Date | string;
  contractTerms?: string | null;
  admin?: PlatformAdminSignerLike | null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDateVi(value: Date | string | null | undefined): string {
  if (!value) return 'Theo hồ sơ pháp lý đã thẩm định';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

const LEGACY_B2B_BOILERPLATE_PREFIX =
  'HỢP ĐỒNG NGUYÊN TẮC CUNG ỨNG NGUỒN NHÂN LỰC Y TẾ B2B';

export function normalizeB2bSupplementaryTerms(
  raw?: string | null,
): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith(LEGACY_B2B_BOILERPLATE_PREFIX)) {
    return null;
  }
  return trimmed;
}

export function buildB2bStaffingContractHtml(
  input: BuildB2bStaffingContractHtmlInput,
): string {
  const platformLegal = resolvePlatformLegalIdentity(input.admin);
  const createdDateStr = formatDateVi(input.createdAt ?? new Date());
  const startDateStr = formatDateVi(input.startDate);
  const endDateStr = formatDateVi(input.endDate);
  const supplementaryTerms =
    normalizeB2bSupplementaryTerms(input.contractTerms) ||
    'Không có thỏa thuận bổ sung nào khác.';

  const licenseIssuer =
    input.facilityLicenseIssuer?.trim() || 'Bộ Y tế / Sở Y tế có thẩm quyền';
  const licenseDateStr = formatDateVi(input.facilityLicenseDate);
  const facilityHotline = input.facilityHotline?.trim() || input.facilityPhone;

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <title>Hợp đồng Nguyên tắc Hợp tác B2B - ${escapeHtml(input.contractNumber)}</title>
  <style>
    @page {
      size: A4;
      margin: 18mm 16mm 18mm 16mm;
    }
    body {
      font-family: 'DejaVu Serif', 'Liberation Serif', 'Times New Roman', serif;
      font-size: 11pt;
      line-height: 1.48;
      color: #111827;
      margin: 0;
      padding: 0;
    }
    .doc-container { max-width: 100%; }
    .header-quoc-hieu { text-align: center; margin-bottom: 12px; }
    .header-quoc-hieu .country {
      font-size: 11.5pt;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .header-quoc-hieu .motto {
      font-size: 11pt;
      font-weight: bold;
      margin-top: 2px;
      text-decoration: underline;
    }
    .title-block { text-align: center; margin: 16px 0 12px 0; }
    .title-block h1 {
      font-size: 13.5pt;
      font-weight: bold;
      text-transform: uppercase;
      line-height: 1.35;
      margin: 0 auto 8px auto;
      max-width: 165mm;
    }
    .meta-row {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 10px 28px;
      font-size: 10.5pt;
      border-top: 1px solid #d1d5db;
      border-bottom: 1px solid #d1d5db;
      padding: 6px 8px;
      background-color: #f9fafb;
    }
    .section-title {
      font-size: 11pt;
      font-weight: bold;
      text-transform: uppercase;
      margin: 14px 0 6px 0;
      border-bottom: 1px solid #d1d5db;
      padding-bottom: 2px;
    }
    .legal-basis ul { margin: 4px 0 8px 18px; padding: 0; }
    .legal-basis li { margin-bottom: 3px; }
    .glossary-box {
      border: 1px solid #cbd5e1;
      background-color: #f9fafb;
      padding: 8px 10px;
      margin: 6px 0;
      border-radius: 4px;
    }
    .party-box {
      border: 1px solid #e5e7eb;
      background-color: #f9fafb;
      padding: 8px 10px;
      margin-bottom: 8px;
      border-radius: 4px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .party-heading { font-weight: bold; margin-bottom: 4px; color: #0f172a; }
    .field-line { margin: 3px 0; }
    .field-label { font-weight: bold; }
    table.pricing-table {
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0;
      font-size: 10.5pt;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    table.pricing-table th,
    table.pricing-table td {
      border: 1px solid #cbd5e1;
      padding: 6px 8px;
      text-align: left;
      vertical-align: middle;
    }
    table.pricing-table th {
      background-color: #f1f5f9;
      font-weight: bold;
      width: 42%;
    }
    p { margin: 5px 0; text-align: justify; }
    .clause-item {
      margin: 5px 0;
      padding-left: 20px;
      text-indent: -20px;
      text-align: justify;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .clause-item.sub {
      padding-left: 38px;
      text-indent: -18px;
      margin-top: 3px;
    }
    .additional-terms-box {
      border: 1px solid #cbd5e1;
      padding: 8px 10px;
      min-height: 44px;
      background-color: #ffffff;
      margin: 6px 0;
      white-space: pre-wrap;
    }
    .signature-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-top: 14px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .signature-card {
      border: 1px solid #cbd5e1;
      padding: 10px;
      border-radius: 4px;
      text-align: center;
      background-color: #fafafa;
      min-height: 155px;
      display: flex;
      flex-direction: column;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .signature-card .sig-title {
      font-weight: bold;
      font-size: 10.5pt;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .signature-card .sig-sub { font-size: 9.5pt; color: #475569; margin-bottom: 8px; }
    .signature-card .sig-space {
      min-height: 82px;
      flex: 1 1 auto;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .signature-card .sig-note {
      font-size: 9pt;
      color: #334155;
      border-top: 1px dotted #94a3b8;
      padding-top: 4px;
      margin-top: 6px;
    }
    .sig-footer-note {
      font-size: 9.5pt;
      color: #334155;
      margin-top: 8px;
      text-align: justify;
      break-inside: avoid;
      page-break-inside: avoid;
    }
  </style>
</head>
<body>
  <div class="doc-container">
    <div class="header-quoc-hieu">
      <div class="country">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
      <div class="motto">Độc lập - Tự do - Hạnh phúc</div>
    </div>

    <div class="title-block">
      <h1>HỢP ĐỒNG NGUYÊN TẮC HỢP TÁC CUNG ỨNG NHÂN LỰC &amp; DỊCH VỤ Y TẾ B2B</h1>
      <div class="meta-row">
        <span><strong>Số hợp đồng:</strong> ${escapeHtml(input.contractNumber)}</span>
        <span><strong>Ngày lập:</strong> ${escapeHtml(createdDateStr)}</span>
        <span><strong>Thời hạn:</strong> ${escapeHtml(startDateStr)} – ${escapeHtml(endDateStr)}</span>
      </div>
    </div>

    <div class="legal-basis">
      <div class="section-title">CĂN CỨ PHÁP LÝ</div>
      <ul>
        <li>Bộ luật Dân sự số 91/2015/QH13 ngày 24/11/2015;</li>
        <li>Luật Thương mại số 36/2005/QH11 ngày 14/06/2005;</li>
        <li>Luật Khám bệnh, chữa bệnh số 15/2023/QH15 ngày 09/01/2023 và Nghị định số 96/2023/NĐ-CP ngày 30/12/2023;</li>
        <li>Thông tư số 21/2019/TT-BYT ngày 21/08/2019 hướng dẫn thí điểm về hoạt động y học gia đình và Thông tư số 32/2023/TT-BYT ngày 31/12/2023;</li>
        <li>Luật Giao dịch điện tử số 20/2023/QH15 ngày 22/06/2023 (Điều 22, 23, 34–38 về chữ ký điện tử chuyên dùng và hợp đồng điện tử);</li>
        <li>Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15 và Nghị định số 13/2023/NĐ-CP ngày 17/04/2023 về bảo vệ dữ liệu cá nhân;</li>
        <li>Nhu cầu, năng lực pháp lý và sự tự nguyện thỏa thuận của Hai Bên thông qua Nền tảng FamiDoc.</li>
      </ul>
    </div>

    <p>
      Hôm nay, thông qua hệ thống ký kết điện tử FamiDoc tại <strong>https://sign.famidoc.online</strong>, Hai Bên dưới đây cùng thống nhất giao kết Hợp đồng nguyên tắc B2B với các nội dung sau:
    </p>

    <div class="section-title">I. THÔNG TIN CÁC BÊN KÝ KẾT</div>

    <div class="party-box">
      <div class="party-heading">1. BÊN A (Bên vận hành Nền tảng Công nghệ Y tế)</div>
      <div class="field-line"><span class="field-label">Tên doanh nghiệp:</span> ${escapeHtml(platformLegal.companyName)}</div>
      <div class="field-line"><span class="field-label">Mã số doanh nghiệp / MST:</span> ${escapeHtml(platformLegal.taxCode)}</div>
      <div class="field-line"><span class="field-label">Địa chỉ trụ sở:</span> ${escapeHtml(platformLegal.address)}</div>
      <div class="field-line"><span class="field-label">Người đại diện:</span> ${escapeHtml(platformLegal.representative)}</div>
      <div class="field-line"><span class="field-label">Email / Hotline hỗ trợ:</span> ${escapeHtml(platformLegal.supportContact)}</div>
    </div>

    <div class="party-box">
      <div class="party-heading">2. BÊN B (Cơ sở khám bệnh, chữa bệnh đối tác)</div>
      <div class="field-line"><span class="field-label">Tên cơ sở y tế:</span> ${escapeHtml(input.facilityName)}</div>
      <div class="field-line"><span class="field-label">Giấy phép hoạt động KBCB số:</span> ${escapeHtml(input.facilityLicenseNumber)} — <span class="field-label">Cơ quan cấp:</span> ${escapeHtml(licenseIssuer)} — <span class="field-label">Ngày cấp:</span> ${escapeHtml(licenseDateStr)}</div>
      <div class="field-line"><span class="field-label">Mã số thuế / Mã số DN:</span> ${escapeHtml(input.facilityTaxCode)}</div>
      <div class="field-line"><span class="field-label">Địa chỉ trụ sở:</span> ${escapeHtml(input.facilityAddress)}</div>
      <div class="field-line"><span class="field-label">Người đại diện:</span> ${escapeHtml(input.facilityRepresentativeName)} — <span class="field-label">Email:</span> ${escapeHtml(input.facilityEmail)} — <span class="field-label">SĐT / Hotline:</span> ${escapeHtml(input.facilityPhone)} / ${escapeHtml(facilityHotline)}</div>
      <div class="field-line"><span class="field-label">Tài khoản quyết toán B2B:</span> ${escapeHtml(input.facilityBankName)} — STK: ${escapeHtml(input.facilityBankAccountNumber)} (${escapeHtml(input.facilityBankAccountHolder)})</div>
    </div>

    <div class="section-title">II. TỶ LỆ PHÂN CHIA DOANH THU &amp; THỜI HẠN HIỆU LỰC</div>
    <table class="pricing-table">
      <tr>
        <th>Tỷ lệ doanh thu Bên B (Cơ sở Y tế) hưởng</th>
        <td><strong>${input.facilityRevenueRate}%</strong> trên doanh thu thuần thực thu phát sinh</td>
      </tr>
      <tr>
        <th>Phí vận hành Nền tảng Bên A (FamiDoc) hưởng</th>
        <td><strong>${input.platformCommissionRate}%</strong> trên doanh thu thuần thực thu phát sinh</td>
      </tr>
      <tr>
        <th>Thời hạn hiệu lực Hợp đồng</th>
        <td>Từ ngày <strong>${escapeHtml(startDateStr)}</strong> đến hết ngày <strong>${escapeHtml(endDateStr)}</strong></td>
      </tr>
      <tr>
        <th>Chu kỳ đối soát &amp; Giải ngân</th>
        <td>Định kỳ hằng tháng (đối soát dự kiến từ ngày 01 đến ngày 05 tháng kế tiếp)</td>
      </tr>
    </table>

    <div class="section-title">III. NỘI DUNG CÁC ĐIỀU KHOẢN HỢP TÁC</div>

    <div class="glossary-box">
      <div class="clause-item"><strong>Điều 1. Giải thích thuật ngữ:</strong></div>
      <div class="clause-item sub"><strong>1.1. Nền tảng FamiDoc:</strong> Hệ thống phần mềm quản lý bác sĩ gia đình, hồ sơ sức khỏe điện tử, ký kết điện tử và đối soát thanh toán do Bên A vận hành.</div>
      <div class="clause-item sub"><strong>1.2. Hợp đồng Dịch vụ 4 bên (MedicalContract):</strong> Hợp đồng cung cấp dịch vụ chăm sóc sức khỏe gia đình giao kết giữa Hộ gia đình, Bên B, Bác sĩ trực thuộc Bên B và Bên A trên cơ sở Hợp đồng B2B này.</div>
      <div class="clause-item sub"><strong>1.3. Thẩm định 2 cấp:</strong> Quy trình kiểm duyệt hồ sơ Bác sĩ gồm Cấp 1 do Bên B xác thực và Cấp 2 do Bên A hậu kiểm kích hoạt trước khi đạt trạng thái ACTIVE.</div>
      <div class="clause-item sub"><strong>1.4. Định biên hộ gia đình (Panel Capacity):</strong> Số lượng hộ gia đình tối đa mỗi Bác sĩ được phụ trách đồng thời (tối đa <strong>30 hộ gia đình/bác sĩ</strong>) nhằm bảo đảm an toàn chuyên môn.</div>
    </div>

    <div class="clause-item">
      <strong>Điều 2. Phạm vi và Mô hình hợp tác:</strong>
      <div class="clause-item sub"><strong>2.1.</strong> Bên B đồng ý cung ứng đội ngũ Bác sĩ thuộc quản lý hợp pháp của mình tham gia Nền tảng FamiDoc để thực hiện khám chữa bệnh tại nhà, tư vấn sức khỏe từ xa (Telehealth) và khám tại cơ sở cho các Hộ gia đình đăng ký gói dịch vụ trên FamiDoc.</div>
      <div class="clause-item sub"><strong>2.2.</strong> Bên A cung cấp hạ tầng công nghệ, tiếp nhận đăng ký gói dịch vụ, điều phối ký kết Hợp đồng 4 bên điện tử, thu hộ qua VietQR và thực hiện đối soát, giải ngân định kỳ cho Bên B.</div>
      <div class="clause-item sub"><strong>2.3.</strong> Hợp đồng B2B này đang có hiệu lực là điều kiện tiên quyết để Bên B khởi tạo tài khoản Bác sĩ mới và tham gia ký kết Hợp đồng 4 bên với Hộ gia đình.</div>
    </div>

    <div class="clause-item">
      <strong>Điều 3. Tiêu chuẩn Nhân sự Y tế &amp; Thẩm định 2 cấp:</strong>
      <div class="clause-item sub"><strong>3.1.</strong> Mọi Bác sĩ do Bên B khởi tạo phải đáp ứng đầy đủ điều kiện hành nghề theo quy định pháp luật và nộp đủ <strong>03 tài liệu scan bắt buộc</strong>: (i) Chứng chỉ / Giấy phép hành nghề KBCB (CCHN/GPHN) còn hiệu lực; (ii) Bằng tốt nghiệp chuyên môn y khoa; (iii) Chứng chỉ / Chứng nhận đào tạo Y học gia đình.</div>
      <div class="clause-item sub"><strong>3.2.</strong> Bác sĩ chỉ được tiếp nhận Hộ gia đình và ký Hợp đồng 4 bên sau khi hoàn tất thẩm định Cấp 1 (Bên B) và Cấp 2 (Bên A) để chuyển sang trạng thái ACTIVE.</div>
      <div class="clause-item sub"><strong>3.3.</strong> Bên B chịu trách nhiệm về tính hợp pháp của nhân sự mình quản lý; khi Bác sĩ hết hạn giấy phép, nghỉ việc hoặc bị đình chỉ hành nghề, Bên B phải thông báo ngay và phối hợp bố trí Bác sĩ thay thế cho các Hộ gia đình đang phụ trách.</div>
    </div>

    <div class="clause-item">
      <strong>Điều 4. Tỷ lệ phân chia doanh thu, Cơ chế đối soát &amp; Nghĩa vụ thuế:</strong>
      <div class="clause-item sub"><strong>4.1.</strong> Hai Bên áp dụng tỷ lệ phân chia doanh thu thuần là <strong>${input.facilityRevenueRate}% cho Bên B</strong> và <strong>${input.platformCommissionRate}% phí vận hành nền tảng cho Bên A</strong> đối với các Hợp đồng 4 bên và Phụ lục phát sinh hợp lệ thuộc phạm vi Bên B.</div>
      <div class="clause-item sub"><strong>4.2.</strong> Doanh thu thuần làm căn cứ quyết toán là tổng giá trị hóa đơn đã thanh toán thành công (PAID) trong kỳ đối soát, trừ đi các khoản hoàn trả cho Hộ gia đình (nếu có theo Hợp đồng 4 bên hoặc giải quyết khiếu nại).</div>
      <div class="clause-item sub"><strong>4.3.</strong> Kỳ đối soát được chốt định kỳ hằng tháng qua Bảng quyết toán điện tử (FacilitySettlement) trên Nền tảng FamiDoc; sau khi Bên B xác nhận, Bên A giải ngân về tài khoản thụ hưởng nêu tại Mục I. Trường hợp có sai lệch, Bên B có quyền gửi yêu cầu đối soát lại kèm chứng từ trước khi chốt chi trả.</div>
      <div class="clause-item sub"><strong>4.4.</strong> Mỗi Bên tự kê khai, xuất hóa đơn và thực hiện đầy đủ nghĩa vụ thuế, phí phát sinh từ phần doanh thu/hoa hồng mình được hưởng theo quy định pháp luật thuế Việt Nam.</div>
    </div>

    <div class="clause-item">
      <strong>Điều 5. Quyền và Nghĩa vụ của Các Bên:</strong>
      <div class="clause-item sub"><strong>5.1. Bên A (FamiDoc):</strong> Bảo đảm vận hành hạ tầng công nghệ ổn định, bảo mật bệnh án điện tử và đối soát minh bạch; không can thiệp chuyên môn y khoa độc lập; thanh toán đúng hạn cho Bên B; có quyền tạm khóa Bác sĩ hoặc từ chối ký Hợp đồng 4 bên nếu phát hiện vi phạm định biên 30 hộ hoặc hồ sơ pháp lý hết hiệu lực.</div>
      <div class="clause-item sub"><strong>5.2. Bên B (Cơ sở Y tế):</strong> Chịu trách nhiệm pháp lý cơ sở chủ quản đối với GPHĐ KBCB, hạ tầng khám chữa bệnh từ xa và chất lượng chuyên môn của Bác sĩ trực thuộc; cam kết duy trì <strong>Bảo hiểm trách nhiệm nghề nghiệp khám bệnh, chữa bệnh</strong> còn hiệu lực trong suốt thời hạn Hợp đồng và chịu trách nhiệm liên đới bồi thường thiệt hại phát sinh từ lỗi chuyên môn của Bác sĩ trực thuộc; bảo đảm Bác sĩ tiếp nhận hồ sơ thành viên trong 24 giờ, ghi nhận tức thời dữ liệu lâm sàng lên hệ thống và tuân thủ giới hạn tối đa 30 hộ gia đình/bác sĩ.</div>
    </div>

    <div class="clause-item">
      <strong>Điều 6. Bảo vệ dữ liệu cá nhân, Bảo mật thông tin &amp; Không lôi kéo:</strong>
      <div class="clause-item sub"><strong>6.1.</strong> Hai Bên tuân thủ Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15 và Nghị định 13/2023/NĐ-CP; hồ sơ sức khỏe, chỉ số sinh tồn và thông tin định danh Hộ gia đình là <strong>Dữ liệu cá nhân nhạy cảm</strong>, chỉ phục vụ khám chữa bệnh và quyết toán hợp lệ, nghiêm cấm mua bán hoặc chuyển giao trái phép.</div>
      <div class="clause-item sub"><strong>6.2.</strong> Trong thời hạn Hợp đồng, Bên B và Bác sĩ trực thuộc không được tự ý tiếp cận hoặc thỏa thuận giao dịch trực tiếp ngoài nền tảng đối với các Hộ gia đình do Bên A kết nối nhằm né tránh phí vận hành nền tảng.</div>
    </div>

    <div class="clause-item">
      <strong>Điều 7. Hiệu lực, Sửa đổi &amp; Đàm phán lại Hợp đồng:</strong>
      <div class="clause-item sub"><strong>7.1.</strong> Hợp đồng có hiệu lực kể từ thời điểm hoàn tất đủ 02 chữ ký điện tử tuần tự trên Documenso cho đến hết ngày ${escapeHtml(endDateStr)}.</div>
      <div class="clause-item sub"><strong>7.2.</strong> Trước khi ký hoàn tất, Bên B có quyền gửi yêu cầu chỉnh sửa kèm lý do cụ thể trên hệ thống để Bên A cập nhật và phát hành lại dự thảo mới. Mọi sửa đổi sau khi Hợp đồng đã có hiệu lực phải được Hai Bên xác nhận bằng văn bản hoặc phụ lục điện tử.</div>
    </div>

    <div class="clause-item">
      <strong>Điều 8. Tạm ngừng, Chấm dứt hợp đồng &amp; Nghĩa vụ bàn giao:</strong>
      <div class="clause-item sub"><strong>8.1.</strong> Bên B có quyền gửi yêu cầu chấm dứt trước hạn kèm lý do hợp lệ; Bên A kiểm tra tác động phụ thuộc (Hợp đồng 4 bên đang hiệu lực/chờ xử lý, lịch khám mở, khiếu nại chưa đóng và kỳ quyết toán chưa chi trả) trước khi phê duyệt chấm dứt.</div>
      <div class="clause-item sub"><strong>8.2.</strong> Khi Hợp đồng chuyển trạng thái TERMINATED, Bên B ngừng khởi tạo Bác sĩ mới và ngừng tiếp nhận Hợp đồng 4 bên mới, nhưng vẫn có nghĩa vụ phối hợp hoàn tất hoặc bàn giao an toàn các Hợp đồng 4 bên và lịch khám đang thực hiện. Toàn bộ công nợ quyết toán (FacilitySettlement) hợp lệ vẫn được bảo toàn để hoàn tất thanh toán.</div>
    </div>

    <div class="clause-item">
      <strong>Điều 9. Công nhận chữ ký điện tử &amp; Trình tự ký kết trên Documenso:</strong>
      <div class="clause-item sub"><strong>9.1.</strong> Căn cứ Điều 22, 23, 34–38 Luật Giao dịch điện tử 20/2023/QH15, Hai Bên công nhận chữ ký điện tử thực hiện trên hệ thống Documenso của FamiDoc (kèm xác thực tài khoản, IP, dấu thời gian UTC+7 và mã băm SHA-256) có giá trị pháp lý tương đương chữ ký tay và con dấu của người đại diện hợp pháp.</div>
      <div class="clause-item sub"><strong>9.2.</strong> Trình tự ký tuần tự 2 bước: (1) Đại diện Bên B (Cơ sở Y tế) ký xác nhận đầu tiên; (2) Đại diện Bên A (Quản trị viên Nền tảng FamiDoc) ký chốt hiệu lực bước hai để kích hoạt Hợp đồng (ACTIVE).</div>
    </div>

    <div class="clause-item">
      <strong>Điều 10. Bất khả kháng, Giải quyết tranh chấp &amp; Hiệu lực chung:</strong>
      <div class="clause-item sub"><strong>10.1.</strong> Khi xảy ra sự kiện bất khả kháng, Bên bị ảnh hưởng thông báo trong vòng 48 giờ để Hai Bên phối hợp điều chỉnh hoặc gia hạn tương ứng.</div>
      <div class="clause-item sub"><strong>10.2.</strong> Tranh chấp phát sinh ưu tiên thương lượng hòa giải trong 15 ngày; nếu không đạt thỏa thuận, một trong Hai Bên có quyền khởi kiện tại <strong>Tòa án nhân dân có thẩm quyền</strong> tại Việt Nam giải quyết theo pháp luật Việt Nam.</div>
      <div class="clause-item sub"><strong>10.3.</strong> Hợp đồng lập bằng tiếng Việt dạng thông điệp dữ liệu điện tử lưu trữ toàn vẹn trên FamiDoc và Documenso, có giá trị pháp lý như nhau đối với cả Hai Bên.</div>
    </div>

    <div class="section-title">IV. ĐIỀU KHOẢN BỔ SUNG / THỎA THUẬN ĐẶC THÙ</div>
    <div class="additional-terms-box">${escapeHtml(supplementaryTerms)}</div>

    <div class="signature-grid">
      <div class="signature-card">
        <div class="sig-title">ĐẠI DIỆN BÊN B (CƠ SỞ Y TẾ)</div>
        <div class="sig-sub">Ký và xác nhận đầu tiên (Bước 1)</div>
        <div class="sig-space">
          <p style="font-family: monospace; font-size: 2px; color: #ffffff; margin: 4px 0;">${DOCUMENSO_SIGNATURE_MARKERS.HEALTHCARE_FACILITY}</p>
        </div>
        <div class="sig-note">${escapeHtml(input.facilityRepresentativeName)}</div>
      </div>
      <div class="signature-card">
        <div class="sig-title">ĐẠI DIỆN BÊN A (NỀN TẢNG FAMIDOC)</div>
        <div class="sig-sub">Ký chốt hiệu lực sau Bên B (Bước 2)</div>
        <div class="sig-space">
          <p style="font-family: monospace; font-size: 2px; color: #ffffff; margin: 4px 0;">${DOCUMENSO_SIGNATURE_MARKERS.ADMIN}</p>
        </div>
        <div class="sig-note">${escapeHtml(platformLegal.representative)}</div>
      </div>
    </div>
    <p class="sig-footer-note">
      <strong>Lưu ý đối chiếu:</strong> Chữ ký điện tử của Hai Bên được thực hiện trên hệ thống Documenso và lưu kèm nhật ký kiểm toán điện tử (danh tính, email xác thực, IP, dấu thời gian và mã băm SHA-256) theo Luật Giao dịch điện tử 20/2023/QH15.
    </p>
  </div>
</body>
</html>`;
}
