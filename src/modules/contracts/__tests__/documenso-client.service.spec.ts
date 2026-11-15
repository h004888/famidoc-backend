import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DocumensoClientService } from '../services/documenso-client.service';

describe('DocumensoClientService', () => {
  let service: DocumensoClientService;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.DOCUMENSO_API_URL = 'https://sign.famidoc.online';
    process.env.DOCUMENSO_API_TOKEN = 'api_test_token_123';
    process.env.DOCUMENSO_WEBHOOK_SECRET = 'whsec_documenso_test';
    service = new DocumensoClientService();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const makeRecipients = () => [
    { role: 'FAMILY_REP' as const, email: 'a@famidoc.online', name: 'Bên A' },
    { role: 'HEALTHCARE_FACILITY' as const, email: 'b@famidoc.online', name: 'Bên B' },
    { role: 'ASSIGNED_DOCTOR' as const, email: 'c@famidoc.online', name: 'Bên C' },
    { role: 'ADMIN' as const, email: 'd@famidoc.online', name: 'Bên D' },
  ];

  it('createFourPartyEnvelope(): gọi đủ 4 bước create -> get -> field/create-many -> distribute và trả token', async () => {
    const fetchMock = jest
      .fn()
      // 1. POST /api/v2/envelope/create
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'envelope_abc123' }),
      })
      // 2. GET /api/v2/envelope/envelope_abc123
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'envelope_abc123',
            status: 'DRAFT',
            envelopeItems: [{ id: 'item_1' }],
            recipients: [
              { id: 101, email: 'a@famidoc.online', name: 'Bên A', role: 'SIGNER', token: 'tok_a', signingStatus: 'NOT_SIGNED' },
              { id: 102, email: 'b@famidoc.online', name: 'Bên B', role: 'SIGNER', token: 'tok_b', signingStatus: 'NOT_SIGNED' },
              { id: 103, email: 'c@famidoc.online', name: 'Bên C', role: 'SIGNER', token: 'tok_c', signingStatus: 'NOT_SIGNED' },
              { id: 104, email: 'd@famidoc.online', name: 'Bên D', role: 'SIGNER', token: 'tok_d', signingStatus: 'NOT_SIGNED' },
            ],
          }),
      })
      // 3. POST /api/v2/envelope/field/create-many
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] }),
      })
      // 4. POST /api/v2/envelope/distribute
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            success: true,
            id: 'envelope_abc123',
            recipients: [
              { id: 101, email: 'a@famidoc.online', name: 'Bên A', role: 'SIGNER', token: 'tok_a', signingUrl: 'https://sign.famidoc.online/sign/tok_a' },
              { id: 102, email: 'b@famidoc.online', name: 'Bên B', role: 'SIGNER', token: 'tok_b', signingUrl: 'https://sign.famidoc.online/sign/tok_b' },
              { id: 103, email: 'c@famidoc.online', name: 'Bên C', role: 'SIGNER', token: 'tok_c', signingUrl: 'https://sign.famidoc.online/sign/tok_c' },
              { id: 104, email: 'd@famidoc.online', name: 'Bên D', role: 'SIGNER', token: 'tok_d', signingUrl: 'https://sign.famidoc.online/sign/tok_d' },
            ],
          }),
      });

    global.fetch = fetchMock;

    const result = await service.createFourPartyEnvelope({
      contractId: 'ctr-uuid-1',
      contractNumber: 'FD-2026-001',
      pdfBuffer: Buffer.from('%PDF-1.4'),
      recipients: makeRecipients(),
    });

    expect(result.envelopeId).toBe('envelope_abc123');
    expect(result.envelopeItemId).toBe('item_1');
    expect(result.signers).toHaveLength(4);
    expect(result.signers.find((s) => s.role === 'FAMILY_REP')).toMatchObject({
      recipientId: 101,
      token: 'tok_a',
      signingUrl: 'https://sign.famidoc.online/sign/tok_a',
    });

    // Kiểm tra body field/create-many dùng { envelopeId, data } với placeholder ASCII
    const fieldCallBody = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(fieldCallBody.envelopeId).toBe('envelope_abc123');
    expect(fieldCallBody.data).toHaveLength(4);
    expect(fieldCallBody.data[0]).toEqual({
      type: 'SIGNATURE',
      recipientId: 101,
      envelopeItemId: 'item_1',
      placeholder: '[[SIG_FAMILY_REP]]',
      width: 24,
      height: 8,
    });

    // Kiểm tra body distribute có envelopeId và distributionMethod: 'NONE'
    const distCallBody = JSON.parse(fetchMock.mock.calls[3][1].body as string);
    expect(distCallBody).toEqual({
      envelopeId: 'envelope_abc123',
      meta: { distributionMethod: 'NONE' },
    });
  });

  it('createFourPartyEnvelope(): rollback xóa envelope nếu số field tạo được < 4', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'envelope_rollback_1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'envelope_rollback_1',
            envelopeItems: [{ id: 'item_1' }],
            recipients: [
              { id: 1, email: 'a@famidoc.online', token: 't1' },
              { id: 2, email: 'b@famidoc.online', token: 't2' },
              { id: 3, email: 'c@famidoc.online', token: 't3' },
              { id: 4, email: 'd@famidoc.online', token: 't4' },
            ],
          }),
      })
      // Chỉ tạo được 2/4 field
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ id: 1 }, { id: 2 }] }),
      })
      // Rollback POST /api/v2/envelope/delete
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

    global.fetch = fetchMock;

    await expect(
      service.createFourPartyEnvelope({
        contractId: 'ctr-uuid-2',
        contractNumber: 'FD-2026-002',
        pdfBuffer: Buffer.from('%PDF-1.4'),
        recipients: makeRecipients(),
      }),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3][0]).toContain('/api/v2/envelope/delete');
    expect(JSON.parse(fetchMock.mock.calls[3][1].body as string)).toEqual({
      envelopeId: 'envelope_rollback_1',
    });
  });

  it('createFourPartyEnvelope(): từ chối nếu email 4 bên bị trùng nhau', async () => {
    const dupRecipients = makeRecipients();
    dupRecipients[1].email = 'a@famidoc.online';

    await expect(
      service.createFourPartyEnvelope({
        contractId: 'ctr-dup',
        contractNumber: 'FD-DUP',
        pdfBuffer: Buffer.from('%PDF'),
        recipients: dupRecipients,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('createFourPartyEnvelope(): lỗi rõ ràng khi thiếu DOCUMENSO_API_TOKEN', async () => {
    process.env.DOCUMENSO_API_TOKEN = '';
    await expect(
      service.createFourPartyEnvelope({
        contractId: 'ctr-no-token',
        contractNumber: 'FD-NO-TOK',
        pdfBuffer: Buffer.from('%PDF'),
        recipients: makeRecipients(),
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('downloadSignedItemPdf(): tải PDF đã ký với header Authorization', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
    });

    const buf = await service.downloadSignedItemPdf('item_signed_1');
    expect(buf.toString('ascii')).toBe('%PDF');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://sign.famidoc.online/api/v2/envelope/item/item_signed_1/download?version=signed',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'api_test_token_123' }),
      }),
    );
  });

  it('getEnvelope(): hỗ trợ response top-level từ Documenso v2', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          id: 'envelope_1',
          status: 'PENDING',
          recipients: [],
          envelopeItems: [{ id: 'item_1' }],
        }),
    });

    const env = await service.getEnvelope('envelope_1');
    expect(env.id).toBe('envelope_1');
    expect(env.status).toBe('PENDING');
  });

  it('verifyWebhookSecret(): xác thực timingSafeEqual đúng/sai/thiếu', () => {
    expect(service.verifyWebhookSecret('whsec_documenso_test')).toBe(true);
    expect(service.verifyWebhookSecret('  whsec_documenso_test  ')).toBe(true);
    expect(service.verifyWebhookSecret('whsec_wrong_secret_1')).toBe(false);
    expect(service.verifyWebhookSecret('short')).toBe(false);
    expect(service.verifyWebhookSecret(undefined)).toBe(false);
  });

  it('deleteEnvelope(): gọi endpoint xóa Envelope và không ném lỗi khi Documenso từ chối', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      })
      .mockRejectedValueOnce(new Error('network timeout'));
    global.fetch = fetchMock;

    await expect(service.deleteEnvelope('envelope_cleanup_1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sign.famidoc.online/api/v2/envelope/delete',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ envelopeId: 'envelope_cleanup_1' }),
      }),
    );

    await expect(service.deleteEnvelope('envelope_cleanup_2')).resolves.toBeUndefined();
  });
});
