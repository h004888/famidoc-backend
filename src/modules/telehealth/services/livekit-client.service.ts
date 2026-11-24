import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AccessToken, DataPacket_Kind, RoomServiceClient, WebhookReceiver } from 'livekit-server-sdk';

export interface IssueTokenParams {
  roomName: string;
  identity: string;
  name: string;
  metadata: Record<string, unknown>;
  ttlSeconds?: number;
}

@Injectable()
export class LivekitClientService {
  private readonly logger = new Logger(LivekitClientService.name);

  private getConfig() {
    return {
      livekitUrl: process.env.LIVEKIT_URL?.trim() ?? '',
      livekitPublicUrl: process.env.LIVEKIT_PUBLIC_URL?.trim() ?? '',
      apiKey: process.env.LIVEKIT_API_KEY?.trim() ?? '',
      apiSecret: process.env.LIVEKIT_API_SECRET?.trim() ?? '',
    };
  }

  private assertConfigured() {
    const cfg = this.getConfig();
    if (!cfg.livekitUrl || !cfg.livekitPublicUrl || !cfg.apiKey || !cfg.apiSecret) {
      throw new ServiceUnavailableException('LiveKit chưa được cấu hình đầy đủ trên máy chủ.');
    }
    return cfg;
  }

  getPublicUrl(): string {
    return this.assertConfigured().livekitPublicUrl;
  }

  async createParticipantToken(params: IssueTokenParams): Promise<string> {
    const cfg = this.assertConfigured();
    const token = new AccessToken(cfg.apiKey, cfg.apiSecret, {
      identity: params.identity,
      name: params.name,
      metadata: JSON.stringify(params.metadata),
      ttl: params.ttlSeconds ?? 7200,
    });

    token.addGrant({
      roomJoin: true,
      room: params.roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return token.toJwt();
  }

  async sendRoomData(roomName: string, payload: Record<string, unknown>): Promise<void> {
    const cfg = this.getConfig();
    if (!cfg.livekitUrl || !cfg.apiKey || !cfg.apiSecret) {
      return;
    }

    try {
      const client = new RoomServiceClient(cfg.livekitUrl, cfg.apiKey, cfg.apiSecret);
      const data = new TextEncoder().encode(JSON.stringify(payload));
      await client.sendData(roomName, data, DataPacket_Kind.RELIABLE);
    } catch (error) {
      this.logger.warn(
        `Không thể gửi DataChannel tới phòng ${roomName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async deleteRoom(roomName: string): Promise<void> {
    const cfg = this.getConfig();
    if (!cfg.livekitUrl || !cfg.apiKey || !cfg.apiSecret) {
      return;
    }

    try {
      const client = new RoomServiceClient(cfg.livekitUrl, cfg.apiKey, cfg.apiSecret);
      await client.deleteRoom(roomName);
    } catch (error) {
      this.logger.warn(
        `Không thể đóng phòng LiveKit ${roomName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async receiveWebhook(rawBody: string, authHeader?: string) {
    const cfg = this.assertConfigured();
    const receiver = new WebhookReceiver(cfg.apiKey, cfg.apiSecret);
    return receiver.receive(rawBody, authHeader);
  }
}
