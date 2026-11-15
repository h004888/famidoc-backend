import {
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Browser, LaunchOptions } from 'puppeteer-core';

export type PuppeteerLaunchFn = (options?: LaunchOptions) => Promise<Browser>;
export const PUPPETEER_LAUNCHER_TOKEN = Symbol('PUPPETEER_LAUNCHER_TOKEN');

/**
 * ContractPdfRendererService — hàng đợi tuần tự hóa (mutex concurrency = 1)
 * sử dụng puppeteer-core + chromium hệ thống để xuất PDF từ HTML string.
 *
 * Cấu hình an toàn trên VPS 4 GB RAM:
 *   --no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu
 *
 * Luôn đóng browser trong khối finally → tiêu thụ 0 MB RAM khi nhàn rỗi.
 */
@Injectable()
export class ContractPdfRendererService {
  private readonly logger = new Logger(ContractPdfRendererService.name);
  private mutexPromise: Promise<void> = Promise.resolve();
  private _browser: Browser | null = null;
  private readonly launchOptions: string[];
  private readonly launcher?: PuppeteerLaunchFn;

  constructor(
    @Optional()
    @Inject(PUPPETEER_LAUNCHER_TOKEN)
    launcher?: PuppeteerLaunchFn,
  ) {
    this.launcher = launcher;
    this.launchOptions = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ];
  }

  private async launchBrowser(): Promise<Browser> {
    const executablePath =
      process.env.CHROMIUM_EXECUTABLE_PATH?.trim() || '/usr/bin/chromium';
    const launchConfig: LaunchOptions = {
      executablePath,
      args: this.launchOptions,
      headless: true,
      timeout: 20_000,
    };

    if (this.launcher) {
      return this.launcher(launchConfig);
    }

    const puppeteer = await import('puppeteer-core');
    return puppeteer.default.launch(launchConfig);
  }

  /**
   * Kết nối Chromium (hoặc tái sử dụng nếu đang mở).
   */
  async connect(): Promise<Browser> {
    if (this._browser) {
      return this._browser;
    }
    this._browser = await this.launchBrowser();
    return this._browser;
  }

  /**
   * Đóng Chromium và giải phóng toàn bộ tài nguyên RAM.
   */
  async disconnect(): Promise<void> {
    const browser = this._browser;
    this._browser = null;
    if (!browser) return;
    await browser.close();
  }

  /**
   * Mutex hàng đợi concurrency = 1 để các yêu cầu xuất PDF chạy tuần tự.
   */
  private acquire(): Promise<() => void> {
    let releaseNext!: () => void;
    const nextLock = new Promise<void>((resolve) => {
      releaseNext = resolve;
    });
    const prevLock = this.mutexPromise;
    this.mutexPromise = prevLock.then(() => nextLock);
    return prevLock.then(() => releaseNext);
  }

  /**
   * Render HTML string thành Buffer PDF khổ A4.
   * Luôn đóng browser trong khối finally để không rò rỉ RAM.
   */
  async renderPdf(html: string): Promise<Buffer> {
    const release = await this.acquire();
    let page: Awaited<ReturnType<Browser['newPage']>> | null = null;

    try {
      const browser = await this.connect();
      page = await browser.newPage();

      await page.setContent(html, {
        waitUntil: 'load',
        timeout: 20_000,
      });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        margin: {
          top: '18mm',
          right: '16mm',
          bottom: '18mm',
          left: '16mm',
        },
        printBackground: true,
      });

      return Buffer.from(pdfBuffer);
    } catch (error) {
      this.logger.error(
        `Lỗi kết xuất PDF hợp đồng: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException(
        `Không thể kết xuất tệp PDF hợp đồng: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      if (page) {
        try {
          await page.close();
        } catch {
          /* ignore page close error */
        }
      }
      try {
        await this.disconnect();
      } catch {
        /* ignore browser close error */
      }
      release();
    }
  }
}
