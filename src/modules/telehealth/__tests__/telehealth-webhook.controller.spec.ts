import { UnauthorizedException } from '@nestjs/common';
import { TelehealthWebhookController } from '../controllers/telehealth-webhook.controller';
import { TelehealthService } from '../services/telehealth.service';

describe('TelehealthWebhookController', () => {
  let controller: TelehealthWebhookController;
  let service: jest.Mocked<TelehealthService>;

  beforeEach(() => {
    service = {
      handleWebhookEvent: jest.fn(),
    } as any;
    controller = new TelehealthWebhookController(service);
  });

  it('từ chối 401 khi chữ ký webhook không hợp lệ', async () => {
    service.handleWebhookEvent.mockRejectedValue(new Error('invalid signature'));

    await expect(
      controller.handleWebhook({ rawBody: Buffer.from('{}') } as any, 'Bearer bad'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('chuyển rawBody và authorization header sang service khi hợp lệ', async () => {
    service.handleWebhookEvent.mockResolvedValue({ received: true });

    const res = await controller.handleWebhook(
      { rawBody: Buffer.from('{"event":"room_finished"}') } as any,
      'Bearer valid-sig',
    );

    expect(res).toEqual({ received: true });
    expect(service.handleWebhookEvent).toHaveBeenCalledWith(
      '{"event":"room_finished"}',
      'Bearer valid-sig',
    );
  });
});
