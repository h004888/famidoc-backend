import {
  type FamiDocEmailPayload,
  renderFamiDocEmailLayout,
  renderKeyValueRows,
  renderNoticeBox,
} from './famidoc-email-layout';

export function buildDoctorProvisioningEmail(params: {
  email: string;
  doctorName: string;
  facilityName: string;
  initialPassword: string;
  loginUrl?: string;
}): FamiDocEmailPayload {
  const doctorName = params.doctorName.trim() || 'Bác sĩ';
  const subject = 'FamiDoc - Thư mời kích hoạt tài khoản Bác sĩ gia đình';

  const textLines = [
    `Kính gửi Bác sĩ ${doctorName},`,
    '',
    `Tài khoản của bạn tại hệ thống FamiDoc đã được tạo bởi ${params.facilityName}.`,
    '',
    'Thông tin đăng nhập:',
    `- Email: ${params.email}`,
    `- Mật khẩu khởi tạo: ${params.initialPassword}`,
    ...(params.loginUrl ? [`- Đường dẫn đăng nhập: ${params.loginUrl}`] : []),
    '',
    'Vui lòng đăng nhập để nộp hồ sơ chuyên môn kèm đủ 3 tài liệu bắt buộc (Chứng chỉ hành nghề, Bằng tốt nghiệp chuyên môn, Chứng chỉ Y học gia đình) và đổi mật khẩu để tăng cường bảo mật.',
    '',
    'Trân trọng,',
    'Đội ngũ FamiDoc',
  ];

  const html = renderFamiDocEmailLayout({
    preheader: `Tài khoản Bác sĩ gia đình FamiDoc của bạn đã được tạo bởi ${params.facilityName}.`,
    badgeLabel: 'Cấp tài khoản mới',
    tone: 'action',
    title: 'Thư mời kích hoạt tài khoản Bác sĩ gia đình',
    greeting: `Kính gửi Bác sĩ ${doctorName},`,
    intro: `Tài khoản của bạn tại hệ thống FamiDoc đã được tạo bởi ${params.facilityName}.`,
    bodyHtml: [
      renderKeyValueRows(
        [
          { label: 'Cơ sở y tế trực thuộc', value: params.facilityName },
          { label: 'Email đăng nhập', value: params.email },
          {
            label: 'Mật khẩu khởi tạo',
            value: params.initialPassword,
            highlight: true,
          },
        ],
        'action',
      ),
      renderNoticeBox({
        title: 'Hướng dẫn bước tiếp theo',
        message:
          'Vui lòng đăng nhập để nộp hồ sơ chuyên môn kèm đủ 3 tài liệu bắt buộc (Chứng chỉ hành nghề, Bằng tốt nghiệp chuyên môn, Chứng chỉ Y học gia đình) và đổi mật khẩu để tăng cường bảo mật.',
        tone: 'action',
      }),
    ].join(''),
    cta: params.loginUrl
      ? { label: 'Đăng nhập cổng Bác sĩ', url: params.loginUrl }
      : undefined,
  });

  return { subject, text: textLines.join('\n'), html };
}

export function buildDoctorLevel2ApprovedEmail(params: {
  doctorName: string;
  loginUrl?: string;
}): FamiDocEmailPayload {
  const doctorName = params.doctorName.trim() || 'Bác sĩ';
  const subject =
    'FamiDoc - Hồ sơ bác sĩ của bạn đã được phê duyệt thành công';

  const textLines = [
    `Kính gửi Bác sĩ ${doctorName},`,
    '',
    'Hồ sơ văn bằng và chứng chỉ hành nghề của bạn đã được Quản trị viên FamiDoc phê duyệt cấp 2. Tài khoản của bạn đã chuyển sang trạng thái ACTIVE và sẵn sàng tiếp nhận bệnh nhân.',
    ...(params.loginUrl ? ['', `Đăng nhập tại: ${params.loginUrl}`] : []),
    '',
    'Trân trọng,',
    'Đội ngũ FamiDoc',
  ];

  const html = renderFamiDocEmailLayout({
    preheader: `Hồ sơ bác sĩ của ${doctorName} đã được phê duyệt Cấp 2 và chuyển sang trạng thái ACTIVE.`,
    badgeLabel: 'Đã phê duyệt',
    tone: 'success',
    title: 'Hồ sơ bác sĩ đã được phê duyệt thành công',
    greeting: `Kính gửi Bác sĩ ${doctorName},`,
    intro:
      'Hồ sơ văn bằng và chứng chỉ hành nghề của bạn đã được Quản trị viên FamiDoc phê duyệt cấp 2.',
    bodyHtml: [
      renderKeyValueRows(
        [
          { label: 'Bác sĩ', value: doctorName },
          {
            label: 'Trạng thái tài khoản',
            value: 'ACTIVE (Đang hoạt động)',
            highlight: true,
          },
        ],
        'success',
      ),
      renderNoticeBox({
        title: 'Sẵn sàng tiếp nhận bệnh nhân',
        message:
          'Tài khoản của bạn đã chuyển sang trạng thái ACTIVE và sẵn sàng tiếp nhận hộ gia đình trên hệ thống FamiDoc.',
        tone: 'success',
      }),
    ].join(''),
    cta: params.loginUrl
      ? { label: 'Truy cập cổng Bác sĩ', url: params.loginUrl }
      : undefined,
  });

  return { subject, text: textLines.join('\n'), html };
}

export function buildDoctorLevel2ApprovedFacilityNoticeEmail(params: {
  facilityName: string;
  doctorName: string;
  loginUrl?: string;
}): FamiDocEmailPayload {
  const subject = `FamiDoc - Bác sĩ ${params.doctorName} đã hoàn tất thẩm định 2 cấp`;

  const textLines = [
    `Kính gửi ${params.facilityName},`,
    '',
    `Bác sĩ ${params.doctorName} đã vượt qua thẩm định Cấp 2 của Quản trị viên FamiDoc và chính thức hoạt động (ACTIVE) trên hệ thống.`,
    ...(params.loginUrl ? ['', `Quản lý đội ngũ tại: ${params.loginUrl}`] : []),
    '',
    'Trân trọng,',
    'Đội ngũ FamiDoc',
  ];

  const html = renderFamiDocEmailLayout({
    preheader: `Bác sĩ ${params.doctorName} đã vượt qua thẩm định Cấp 2 và hoạt động chính thức.`,
    badgeLabel: 'Hoàn tất thẩm định',
    tone: 'success',
    title: 'Bác sĩ trực thuộc đã hoàn tất thẩm định 2 cấp',
    greeting: `Kính gửi ${params.facilityName},`,
    intro: `Bác sĩ ${params.doctorName} đã vượt qua thẩm định Cấp 2 của Quản trị viên FamiDoc và chính thức hoạt động (ACTIVE) trên hệ thống.`,
    bodyHtml: renderKeyValueRows(
      [
        { label: 'Cơ sở y tế', value: params.facilityName },
        { label: 'Bác sĩ', value: params.doctorName },
        { label: 'Trạng thái', value: 'ACTIVE', highlight: true },
      ],
      'success',
    ),
    cta: params.loginUrl
      ? { label: 'Xem trên cổng Đối tác', url: params.loginUrl }
      : undefined,
  });

  return { subject, text: textLines.join('\n'), html };
}

export function buildDoctorLevel2RejectedEmail(params: {
  doctorName: string;
  rejectionReason: string;
  loginUrl?: string;
}): FamiDocEmailPayload {
  const doctorName = params.doctorName.trim() || 'Bác sĩ';
  const subject =
    'FamiDoc - Hồ sơ chuyên môn bác sĩ cần bổ sung (Thẩm định Cấp 2)';

  const textLines = [
    `Kính gửi Bác sĩ ${doctorName},`,
    '',
    'Hồ sơ văn bằng và chứng chỉ hành nghề của bạn chưa đạt yêu cầu ở bước hậu kiểm Cấp 2.',
    `Lý do: ${params.rejectionReason}`,
    '',
    'Vui lòng đăng nhập vào cổng Bác sĩ FamiDoc để cập nhật lại hồ sơ và gửi thẩm định lại.',
    ...(params.loginUrl ? [`Đường dẫn đăng nhập: ${params.loginUrl}`] : []),
    '',
    'Trân trọng,',
    'Đội ngũ FamiDoc',
  ];

  const html = renderFamiDocEmailLayout({
    preheader: `Hồ sơ chuyên môn của Bác sĩ ${doctorName} cần bổ sung ở bước Thẩm định Cấp 2.`,
    badgeLabel: 'Cần bổ sung hồ sơ',
    tone: 'warning',
    title: 'Hồ sơ chuyên môn cần bổ sung',
    greeting: `Kính gửi Bác sĩ ${doctorName},`,
    intro:
      'Hồ sơ văn bằng và chứng chỉ hành nghề của bạn chưa đạt yêu cầu ở bước hậu kiểm Cấp 2.',
    bodyHtml: [
      renderNoticeBox({
        title: 'Lý do cần bổ sung',
        message: params.rejectionReason,
        tone: 'warning',
      }),
      renderNoticeBox({
        title: 'Hướng dẫn xử lý',
        message:
          'Vui lòng đăng nhập vào cổng Bác sĩ FamiDoc để cập nhật lại hồ sơ và gửi thẩm định lại.',
        tone: 'info',
      }),
    ].join(''),
    cta: params.loginUrl
      ? { label: 'Cập nhật hồ sơ ngay', url: params.loginUrl }
      : undefined,
  });

  return { subject, text: textLines.join('\n'), html };
}

export function buildDoctorLevel2RejectedFacilityNoticeEmail(params: {
  facilityName: string;
  doctorName: string;
  rejectionReason: string;
  loginUrl?: string;
}): FamiDocEmailPayload {
  const subject = `FamiDoc - Hồ sơ bác sĩ ${params.doctorName} bị từ chối ở Thẩm định Cấp 2`;

  const textLines = [
    `Kính gửi ${params.facilityName},`,
    '',
    `Hồ sơ bác sĩ ${params.doctorName} chưa đạt phê duyệt Cấp 2 của Quản trị viên FamiDoc.`,
    `Lý do: ${params.rejectionReason}`,
    '',
    'Bác sĩ cần bổ sung lại hồ sơ để Cơ sở y tế thẩm định Cấp 1 lại trước khi trình duyệt Cấp 2.',
    ...(params.loginUrl ? [`Đường dẫn đăng nhập: ${params.loginUrl}`] : []),
    '',
    'Trân trọng,',
    'Đội ngũ FamiDoc',
  ];

  const html = renderFamiDocEmailLayout({
    preheader: `Hồ sơ bác sĩ ${params.doctorName} chưa đạt phê duyệt Cấp 2.`,
    badgeLabel: 'Từ chối Cấp 2',
    tone: 'warning',
    title: 'Hồ sơ bác sĩ chưa đạt Thẩm định Cấp 2',
    greeting: `Kính gửi ${params.facilityName},`,
    intro: `Hồ sơ bác sĩ ${params.doctorName} chưa đạt phê duyệt Cấp 2 của Quản trị viên FamiDoc.`,
    bodyHtml: [
      renderKeyValueRows(
        [
          { label: 'Cơ sở y tế', value: params.facilityName },
          { label: 'Bác sĩ', value: params.doctorName },
        ],
        'warning',
      ),
      renderNoticeBox({
        title: 'Lý do từ chối Cấp 2',
        message: params.rejectionReason,
        tone: 'warning',
      }),
      renderNoticeBox({
        title: 'Lưu ý quy trình',
        message:
          'Bác sĩ cần bổ sung lại hồ sơ để Cơ sở y tế thẩm định Cấp 1 lại trước khi trình duyệt Cấp 2.',
        tone: 'info',
      }),
    ].join(''),
    cta: params.loginUrl
      ? { label: 'Đăng nhập cổng Đối tác', url: params.loginUrl }
      : undefined,
  });

  return { subject, text: textLines.join('\n'), html };
}

export function buildFacilityProvisioningEmail(params: {
  recipientName?: string | null;
  facilityName: string;
  email: string;
  initialPassword: string;
  loginUrl?: string;
}): FamiDocEmailPayload {
  const recipientDisplay =
    params.recipientName?.trim() || params.facilityName;
  const subject = 'FamiDoc - Thông báo cấp tài khoản Cơ sở y tế đối tác';

  const textLines = [
    `Kính gửi ${recipientDisplay},`,
    '',
    `Quản trị viên FamiDoc đã khởi tạo tài khoản cổng đối tác cho ${params.facilityName}.`,
    '',
    'Thông tin đăng nhập:',
    `- Email: ${params.email}`,
    `- Mật khẩu khởi tạo: ${params.initialPassword}`,
    ...(params.loginUrl ? [`- Đường dẫn đăng nhập: ${params.loginUrl}`] : []),
    '',
    'Vui lòng đăng nhập vào hệ thống để nộp hồ sơ pháp lý (Giấy phép hoạt động, Mã số thuế, Tài khoản ngân hàng) và đổi mật khẩu để tăng cường bảo mật.',
    '',
    'Trân trọng,',
    'Đội ngũ FamiDoc',
  ];

  const html = renderFamiDocEmailLayout({
    preheader: `Tài khoản cổng đối tác FamiDoc cho ${params.facilityName} đã được khởi tạo.`,
    badgeLabel: 'Cấp tài khoản Đối tác',
    tone: 'action',
    title: 'Thông báo cấp tài khoản Cơ sở y tế đối tác',
    greeting: `Kính gửi ${recipientDisplay},`,
    intro: `Quản trị viên FamiDoc đã khởi tạo tài khoản cổng đối tác cho ${params.facilityName}.`,
    bodyHtml: [
      renderKeyValueRows(
        [
          { label: 'Cơ sở y tế', value: params.facilityName },
          { label: 'Email đăng nhập', value: params.email },
          {
            label: 'Mật khẩu khởi tạo',
            value: params.initialPassword,
            highlight: true,
          },
        ],
        'action',
      ),
      renderNoticeBox({
        title: 'Hướng dẫn kích hoạt',
        message:
          'Vui lòng đăng nhập vào hệ thống để nộp hồ sơ pháp lý (Giấy phép hoạt động, Mã số thuế, Tài khoản ngân hàng) và đổi mật khẩu để tăng cường bảo mật.',
        tone: 'action',
      }),
    ].join(''),
    cta: params.loginUrl
      ? { label: 'Đăng nhập cổng Đối tác', url: params.loginUrl }
      : undefined,
  });

  return { subject, text: textLines.join('\n'), html };
}

export function buildFacilityLegalApprovedEmail(params: {
  recipientName?: string | null;
  facilityName: string;
  loginUrl?: string;
}): FamiDocEmailPayload {
  const recipientDisplay =
    params.recipientName?.trim() || params.facilityName;
  const subject =
    'FamiDoc - Chúc mừng! Hồ sơ pháp lý cơ sở y tế đã được kích hoạt thành công';

  const textLines = [
    `Kính gửi ${recipientDisplay},`,
    '',
    'Hồ sơ pháp lý và tài khoản ngân hàng của quý cơ sở đã được Quản trị viên FamiDoc thẩm định và kích hoạt thành công (ACTIVE).',
    '',
    'Quý cơ sở hiện đã có thể tiếp nhận và ký hợp đồng cung ứng nhân lực B2B từ Quản trị viên.',
    ...(params.loginUrl ? ['', `Đăng nhập tại: ${params.loginUrl}`] : []),
    '',
    'Trân trọng,',
    'Đội ngũ FamiDoc',
  ];

  const html = renderFamiDocEmailLayout({
    preheader: `Hồ sơ pháp lý của ${params.facilityName} đã được kích hoạt thành công (ACTIVE).`,
    badgeLabel: 'Đã kích hoạt',
    tone: 'success',
    title: 'Hồ sơ pháp lý cơ sở y tế đã được kích hoạt',
    greeting: `Kính gửi ${recipientDisplay},`,
    intro:
      'Hồ sơ pháp lý và tài khoản ngân hàng của quý cơ sở đã được Quản trị viên FamiDoc thẩm định và kích hoạt thành công (ACTIVE).',
    bodyHtml: [
      renderKeyValueRows(
        [
          { label: 'Cơ sở y tế', value: params.facilityName },
          {
            label: 'Trạng thái pháp lý',
            value: 'ACTIVE (Đủ điều kiện ký B2B)',
            highlight: true,
          },
        ],
        'success',
      ),
      renderNoticeBox({
        title: 'Bước tiếp theo',
        message:
          'Quý cơ sở hiện đã có thể tiếp nhận và ký hợp đồng cung ứng nhân lực B2B từ Quản trị viên.',
        tone: 'success',
      }),
    ].join(''),
    cta: params.loginUrl
      ? { label: 'Truy cập cổng Đối tác', url: params.loginUrl }
      : undefined,
  });

  return { subject, text: textLines.join('\n'), html };
}

export function buildFacilityLegalRejectedEmail(params: {
  recipientName?: string | null;
  facilityName: string;
  reason: string;
  loginUrl?: string;
}): FamiDocEmailPayload {
  const recipientDisplay =
    params.recipientName?.trim() || params.facilityName;
  const subject = 'FamiDoc - Yêu cầu bổ sung hồ sơ pháp lý Cơ sở y tế';

  const textLines = [
    `Kính gửi ${recipientDisplay},`,
    '',
    'Hồ sơ pháp lý của quý cơ sở chưa đạt yêu cầu thẩm định.',
    `Lý do: ${params.reason}`,
    '',
    'Vui lòng đăng nhập vào cổng đối tác để cập nhật thông tin và tải lại tài liệu hợp lệ.',
    ...(params.loginUrl ? [`Đường dẫn đăng nhập: ${params.loginUrl}`] : []),
    '',
    'Trân trọng,',
    'Đội ngũ FamiDoc',
  ];

  const html = renderFamiDocEmailLayout({
    preheader: `Hồ sơ pháp lý của ${params.facilityName} cần bổ sung hoặc chỉnh sửa.`,
    badgeLabel: 'Cần bổ sung hồ sơ',
    tone: 'warning',
    title: 'Yêu cầu bổ sung hồ sơ pháp lý',
    greeting: `Kính gửi ${recipientDisplay},`,
    intro: `Hồ sơ pháp lý của ${params.facilityName} chưa đạt yêu cầu thẩm định.`,
    bodyHtml: [
      renderNoticeBox({
        title: 'Lý do chưa đạt yêu cầu',
        message: params.reason,
        tone: 'warning',
      }),
      renderNoticeBox({
        title: 'Hướng dẫn bổ sung',
        message:
          'Vui lòng đăng nhập vào cổng đối tác để cập nhật thông tin và tải lại tài liệu hợp lệ.',
        tone: 'info',
      }),
    ].join(''),
    cta: params.loginUrl
      ? { label: 'Cập nhật hồ sơ pháp lý', url: params.loginUrl }
      : undefined,
  });

  return { subject, text: textLines.join('\n'), html };
}
