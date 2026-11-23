import {
  type FamiDocEmailPayload,
  renderFamiDocEmailLayout,
  renderKeyValueRows,
  renderNoticeBox,
} from './famidoc-email-layout';

export function buildMatchingQueueIntakeEmail(params: {
  recipientName?: string | null;
  queueRequestId: string;
  packageName: string;
  memberCount: number;
  slaHours: number;
  trackingUrl?: string;
}): FamiDocEmailPayload {
  const safeName = params.recipientName?.trim() || 'Quý khách';
  const subject =
    'FamiDoc - Đã tiếp nhận yêu cầu tìm bác sĩ vào hàng chờ điều phối';

  const textLines = [
    `Xin chào ${safeName},`,
    '',
    `Yêu cầu tìm bác sĩ gia đình cho gói ${params.packageName} (${params.memberCount} thành viên) đã được chuyển vào hàng chờ điều phối của Quản trị viên FamiDoc (mã yêu cầu: ${params.queueRequestId}).`,
    `Chúng tôi sẽ phân công bác sĩ phù hợp và gửi thông báo cho bạn trong vòng ${params.slaHours} giờ.`,
    ...(params.trackingUrl ? ['', `Theo dõi yêu cầu tại: ${params.trackingUrl}`] : []),
    '',
    'Trân trọng,',
    'Đội ngũ FamiDoc',
  ];

  const html = renderFamiDocEmailLayout({
    preheader: `Đã tiếp nhận yêu cầu tìm bác sĩ gói ${params.packageName} vào hàng chờ điều phối (SLA ${params.slaHours} giờ).`,
    badgeLabel: 'Đã tiếp nhận',
    tone: 'info',
    title: 'Đã tiếp nhận yêu cầu tìm bác sĩ gia đình',
    greeting: `Xin chào ${safeName},`,
    intro:
      'Yêu cầu tìm bác sĩ gia đình của bạn đã được chuyển vào hàng chờ điều phối của Quản trị viên FamiDoc.',
    bodyHtml: [
      renderKeyValueRows(
        [
          { label: 'Mã yêu cầu', value: params.queueRequestId },
          { label: 'Gói dịch vụ', value: params.packageName },
          {
            label: 'Số thành viên',
            value: `${params.memberCount} thành viên`,
          },
          {
            label: 'Thời hạn xử lý SLA',
            value: `Trong vòng ${params.slaHours} giờ`,
            highlight: true,
          },
        ],
        'info',
      ),
      renderNoticeBox({
        title: 'Thông báo tiếp theo',
        message: `Chúng tôi sẽ phân công bác sĩ phù hợp và gửi thông báo cho bạn trong vòng ${params.slaHours} giờ.`,
        tone: 'info',
      }),
    ].join(''),
    cta: params.trackingUrl
      ? { label: 'Theo dõi yêu cầu', url: params.trackingUrl }
      : undefined,
  });

  return { subject, text: textLines.join('\n'), html };
}

export function buildMatchingQueueAssignedEmail(params: {
  recipientName?: string | null;
  doctorName: string;
  facilityName: string;
  packageName: string;
  confirmUrl?: string;
}): FamiDocEmailPayload {
  const safeName = params.recipientName?.trim() || 'Quý khách';
  const subject =
    'FamiDoc - Đã phân công bác sĩ gia đình, mời xác nhận hợp đồng';

  const textLines = [
    `Xin chào ${safeName},`,
    '',
    `Quản trị viên FamiDoc đã phân công bác sĩ ${params.doctorName} (${params.facilityName}) cho gói ${params.packageName}.`,
    params.confirmUrl
      ? `Vui lòng truy cập ${params.confirmUrl} để xem thông tin bác sĩ và xác nhận khởi tạo hợp đồng 4 bên.`
      : 'Vui lòng đăng nhập vào FamiDoc để xem thông tin bác sĩ và xác nhận khởi tạo hợp đồng 4 bên.',
    '',
    'Trân trọng,',
    'Đội ngũ FamiDoc',
  ];

  const html = renderFamiDocEmailLayout({
    preheader: `Bác sĩ ${params.doctorName} (${params.facilityName}) đã được phân công cho gói ${params.packageName}.`,
    badgeLabel: 'Đã phân công bác sĩ',
    tone: 'action',
    title: 'Đã phân công bác sĩ gia đình cho yêu cầu của bạn',
    greeting: `Xin chào ${safeName},`,
    intro:
      'Quản trị viên FamiDoc đã phân công bác sĩ gia đình phù hợp cho yêu cầu của bạn.',
    bodyHtml: [
      renderKeyValueRows(
        [
          {
            label: 'Bác sĩ phụ trách',
            value: params.doctorName,
            highlight: true,
          },
          { label: 'Cơ sở y tế', value: params.facilityName },
          { label: 'Gói dịch vụ', value: params.packageName },
        ],
        'action',
      ),
      renderNoticeBox({
        title: 'Bước tiếp theo',
        message:
          'Vui lòng xem thông tin bác sĩ được phân công và xác nhận khởi tạo hợp đồng 4 bên.',
        tone: 'action',
      }),
    ].join(''),
    cta: params.confirmUrl
      ? { label: 'Xác nhận hợp đồng', url: params.confirmUrl }
      : undefined,
  });

  return { subject, text: textLines.join('\n'), html };
}
