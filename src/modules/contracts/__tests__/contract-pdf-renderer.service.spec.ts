import { ServiceUnavailableException } from '@nestjs/common';
import {
  ContractPdfRendererService,
  type PuppeteerConnectFn,
  type PuppeteerLaunchFn,
} from '../services/contract-pdf-renderer.service';

describe('ContractPdfRendererService (Puppeteer-core, mutex queue = 1)', () => {
  it('renderPdf(): kết nối Chromium, setContent, xuất PDF A4 và đóng browser sau khi xong', async () => {
    const pageClose = jest.fn().mockResolvedValue(undefined);
    const setContent = jest.fn().mockResolvedValue(undefined);
    const pdf = jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock'));
    const browserClose = jest.fn().mockResolvedValue(undefined);
    const launcher = jest.fn().mockResolvedValue({
      newPage: jest.fn().mockResolvedValue({
        setContent,
        pdf,
        close: pageClose,
      }),
      close: browserClose,
    }) as unknown as jest.Mock & PuppeteerLaunchFn;

    const service = new ContractPdfRendererService(launcher);
    const buffer = await service.renderPdf('<html><body>Xin chào</body></html>');

    expect(buffer.toString('utf8')).toBe('%PDF-1.4 mock');
    expect(launcher).toHaveBeenCalledTimes(1);
    expect(launcher).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
        headless: true,
      }),
    );
    expect(setContent).toHaveBeenCalledWith(
      '<html><body>Xin chào</body></html>',
      expect.objectContaining({ waitUntil: 'load' }),
    );
    expect(pdf).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'A4', printBackground: true }),
    );
    expect(pageClose).toHaveBeenCalledTimes(1);
    expect(browserClose).toHaveBeenCalledTimes(1);
  });

  it('tuần tự hóa các lần render đồng thời qua mutex queue concurrency = 1', async () => {
    const events: string[] = [];
    let callIdx = 0;

    const launcher: PuppeteerLaunchFn = jest.fn(async () => {
      const id = ++callIdx;
      events.push(`launch-${id}`);
      return {
        newPage: jest.fn(async () => ({
          setContent: jest.fn(async () => {
            events.push(`setContent-${id}`);
            await new Promise((r) => setTimeout(r, 15));
          }),
          pdf: jest.fn(async () => {
            events.push(`pdf-${id}`);
            return Buffer.from(`pdf-${id}`);
          }),
          close: jest.fn(async () => {
            events.push(`pageClose-${id}`);
          }),
        })),
        close: jest.fn(async () => {
          events.push(`browserClose-${id}`);
        }),
      } as any;
    });

    const service = new ContractPdfRendererService(launcher);

    const [res1, res2] = await Promise.all([
      service.renderPdf('<html>1</html>'),
      service.renderPdf('<html>2</html>'),
    ]);

    expect(res1.toString('utf8')).toBe('pdf-1');
    expect(res2.toString('utf8')).toBe('pdf-2');
    expect(events).toEqual([
      'launch-1',
      'setContent-1',
      'pdf-1',
      'pageClose-1',
      'browserClose-1',
      'launch-2',
      'setContent-2',
      'pdf-2',
      'pageClose-2',
      'browserClose-2',
    ]);
  });

  it('đóng page và browser trong finally ngay cả khi setContent gặp lỗi', async () => {
    const pageClose = jest.fn().mockResolvedValue(undefined);
    const browserClose = jest.fn().mockResolvedValue(undefined);

    const launcher: PuppeteerLaunchFn = jest.fn().mockResolvedValue({
      newPage: jest.fn().mockResolvedValue({
        setContent: jest.fn().mockRejectedValue(new Error('Invalid HTML')),
        pdf: jest.fn(),
        close: pageClose,
      }),
      close: browserClose,
    } as any);

    const service = new ContractPdfRendererService(launcher);

    await expect(service.renderPdf('<invalid>')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(pageClose).toHaveBeenCalledTimes(1);
    expect(browserClose).toHaveBeenCalledTimes(1);
  });

  it('connect(): gọi nhiều lần khi browser đang mở sẽ tái sử dụng browser hiện tại', async () => {
    const launcher = jest.fn().mockResolvedValue({
      close: jest.fn().mockResolvedValue(undefined),
    });

    const service = new ContractPdfRendererService(launcher as any);
    await service.connect();
    await service.connect();

    expect(launcher).toHaveBeenCalledTimes(1);
    await service.disconnect();
    await service.disconnect();
  });

  describe('Remote Browserless WebSocket (PUPPETEER_BROWSER_WS_ENDPOINT)', () => {
    const originalWsEndpoint = process.env.PUPPETEER_BROWSER_WS_ENDPOINT;

    afterEach(() => {
      if (originalWsEndpoint === undefined) {
        delete process.env.PUPPETEER_BROWSER_WS_ENDPOINT;
      } else {
        process.env.PUPPETEER_BROWSER_WS_ENDPOINT = originalWsEndpoint;
      }
    });

    it('khi PUPPETEER_BROWSER_WS_ENDPOINT được đặt, ưu tiên gọi connector và không gọi launcher cục bộ', async () => {
      process.env.PUPPETEER_BROWSER_WS_ENDPOINT =
        'ws://chromium-renderer:3000?token=test-token';

      const pageClose = jest.fn().mockResolvedValue(undefined);
      const setContent = jest.fn().mockResolvedValue(undefined);
      const pdf = jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 remote'));
      const browserClose = jest.fn().mockResolvedValue(undefined);

      const launcher = jest.fn() as unknown as jest.Mock & PuppeteerLaunchFn;
      const connector = jest.fn().mockResolvedValue({
        newPage: jest.fn().mockResolvedValue({
          setContent,
          pdf,
          close: pageClose,
        }),
        close: browserClose,
      }) as unknown as jest.Mock & PuppeteerConnectFn;

      const service = new ContractPdfRendererService(launcher, connector);
      const buffer = await service.renderPdf('<html><body>HĐ</body></html>');

      expect(buffer.toString('utf8')).toBe('%PDF-1.4 remote');
      expect(connector).toHaveBeenCalledTimes(1);
      expect(connector).toHaveBeenCalledWith({
        browserWSEndpoint: 'ws://chromium-renderer:3000?token=test-token',
      });
      expect(launcher).not.toHaveBeenCalled();
      expect(pageClose).toHaveBeenCalledTimes(1);
      expect(browserClose).toHaveBeenCalledTimes(1);
    });

    it('khi PUPPETEER_BROWSER_WS_ENDPOINT rỗng hoặc chỉ có khoảng trắng, fallback về launcher cục bộ', async () => {
      process.env.PUPPETEER_BROWSER_WS_ENDPOINT = '   ';

      const browserClose = jest.fn().mockResolvedValue(undefined);
      const launcher = jest.fn().mockResolvedValue({
        newPage: jest.fn().mockResolvedValue({
          setContent: jest.fn().mockResolvedValue(undefined),
          pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 local')),
          close: jest.fn().mockResolvedValue(undefined),
        }),
        close: browserClose,
      }) as unknown as jest.Mock & PuppeteerLaunchFn;
      const connector = jest.fn() as unknown as jest.Mock & PuppeteerConnectFn;

      const service = new ContractPdfRendererService(launcher, connector);
      const buffer = await service.renderPdf('<html><body>Local</body></html>');

      expect(buffer.toString('utf8')).toBe('%PDF-1.4 local');
      expect(launcher).toHaveBeenCalledTimes(1);
      expect(connector).not.toHaveBeenCalled();
    });

    it('khi connector lỗi kết nối WebSocket, ném ServiceUnavailableException và giải phóng mutex', async () => {
      process.env.PUPPETEER_BROWSER_WS_ENDPOINT =
        'ws://chromium-renderer:3000?token=test-token';

      const connector = jest
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({
          newPage: jest.fn().mockResolvedValue({
            setContent: jest.fn().mockResolvedValue(undefined),
            pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 recovered')),
            close: jest.fn().mockResolvedValue(undefined),
          }),
          close: jest.fn().mockResolvedValue(undefined),
        }) as unknown as jest.Mock & PuppeteerConnectFn;

      const service = new ContractPdfRendererService(undefined, connector);

      await expect(service.renderPdf('<html>1</html>')).rejects.toThrow(
        ServiceUnavailableException,
      );

      const recovered = await service.renderPdf('<html>2</html>');
      expect(recovered.toString('utf8')).toBe('%PDF-1.4 recovered');
    });
  });
});
