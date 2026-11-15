import { ServiceUnavailableException } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { CoreMailerService } from '../mailer/core-mailer.service';

describe('CoreMailerService', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.JMAP_URL;
    delete process.env.JMAP_USERNAME;
    delete process.env.JMAP_PASSWORD;
    delete process.env.JMAP_TOKEN;
    delete process.env.SMTP_URL;
    delete process.env.MAIL_FROM;
    delete process.env.MAIL_TIMEOUT_MS;
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('ném ServiceUnavailableException khi chưa cấu hình JMAP hoặc SMTP', async () => {
    const service = new CoreMailerService();
    await expect(
      service.sendMail({ to: 'user@example.com', subject: 'Test', text: 'Hi' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('gửi thành công qua JMAP HTTPS khi cấu hình đầy đủ', async () => {
    process.env.MAIL_FROM = 'FamiDoc Healthcare <noreply@famidoc.online>';
    process.env.JMAP_URL = 'https://mail.famidoc.online/.well-known/jmap';
    process.env.JMAP_USERNAME = 'noreply@famidoc.online';
    process.env.JMAP_PASSWORD = 'secret';

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apiUrl: 'https://mail.famidoc.online/jmap/',
          primaryAccounts: {
            'urn:ietf:params:jmap:mail': 'c',
            'urn:ietf:params:jmap:submission': 'c',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          methodResponses: [
            [
              'Mailbox/get',
              {
                list: [
                  { id: 'd', role: 'drafts' },
                  { id: 'e', role: 'sent' },
                ],
              },
              'm0',
            ],
            [
              'Identity/get',
              { list: [{ id: 'b', email: 'noreply@famidoc.online' }] },
              'i0',
            ],
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          methodResponses: [
            ['Email/set', { created: { draft1: { id: 'msg1' } } }, 'e0'],
            [
              'EmailSubmission/set',
              { created: { sub1: { id: 'sub1' } } },
              's0',
            ],
          ],
        }),
      });
    global.fetch = fetchMock as any;

    const service = new CoreMailerService();
    await service.sendMail({
      to: 'user@gmail.com',
      subject: 'OTP',
      text: 'Ma OTP: 123456',
      html: '<p>Ma OTP: <b>123456</b></p>',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const submitCall = fetchMock.mock.calls[2];
    const submitBody = JSON.parse(submitCall[1].body);
    expect(submitBody.methodCalls[0][0]).toBe('Email/set');
    expect(submitBody.methodCalls[1][0]).toBe('EmailSubmission/set');
    expect(submitBody.methodCalls[0][1].create.draft1.htmlBody).toEqual([
      { partId: 'html', type: 'text/html' },
    ]);
  });

  it('fallback sang pooled SMTP với timeout 5s khi JMAP lỗi mạng', async () => {
    process.env.MAIL_FROM = 'FamiDoc Healthcare <noreply@famidoc.online>';
    process.env.JMAP_URL = 'https://mail.famidoc.online/.well-known/jmap';
    process.env.JMAP_TOKEN = 'tok';
    process.env.SMTP_URL = 'smtps://user:pass@mail.famidoc.online:465';
    process.env.MAIL_TIMEOUT_MS = '5000';

    global.fetch = jest.fn().mockRejectedValue(new Error('JMAP timeout')) as any;
    const sendMailMock = jest.fn().mockResolvedValue({ messageId: 'smtp-1' });
    const createTransportSpy = jest
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail: sendMailMock, close: jest.fn() } as any);

    const service = new CoreMailerService();
    const result = await service.sendMail({
      to: 'user@gmail.com',
      subject: 'OTP',
      text: '123456',
    });

    expect(result).toEqual({ messageId: 'smtp-1' });
    expect(createTransportSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'smtps://user:pass@mail.famidoc.online:465',
        pool: true,
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 5000,
      }),
    );
    expect(sendMailMock).toHaveBeenCalled();
    service.onModuleDestroy();
  });

  it('ném ServiceUnavailableException khi cả JMAP và SMTP đều thất bại', async () => {
    process.env.MAIL_FROM = 'noreply@famidoc.online';
    process.env.JMAP_URL = 'https://mail.famidoc.online/.well-known/jmap';
    process.env.JMAP_TOKEN = 'tok';
    process.env.SMTP_URL = 'smtps://user:pass@mail.famidoc.online:465';

    global.fetch = jest.fn().mockRejectedValue(new Error('JMAP down')) as any;
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({
      sendMail: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
      close: jest.fn(),
    } as any);

    const service = new CoreMailerService();
    await expect(
      service.sendMail({ to: 'user@gmail.com', subject: 'OTP', text: '123456' }),
    ).rejects.toThrow(ServiceUnavailableException);
    service.onModuleDestroy();
  });
});
