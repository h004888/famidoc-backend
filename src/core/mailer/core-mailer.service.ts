import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  from?: string;
  replyTo?: string;
}

interface JmapAddress {
  name?: string;
  email: string;
}

interface JmapContext {
  apiUrl: string;
  accountId: string;
  submissionAccountId: string;
  draftsMailboxId: string;
  sentMailboxId?: string;
  identityId: string;
  fetchedAt: number;
}

const DEFAULT_MAIL_TIMEOUT_MS = 5000;
const JMAP_SESSION_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class CoreMailerService implements OnModuleDestroy {
  private readonly logger = new Logger(CoreMailerService.name);
  private smtpTransporter: Transporter | null = null;
  private smtpUrlCached: string | null = null;
  private jmapCache: JmapContext | null = null;

  onModuleDestroy(): void {
    if (this.smtpTransporter && typeof this.smtpTransporter.close === 'function') {
      this.smtpTransporter.close();
    }
    this.smtpTransporter = null;
    this.smtpUrlCached = null;
    this.jmapCache = null;
  }

  async sendMail(options: SendMailOptions): Promise<unknown> {
    const mailFrom = (options.from || process.env.MAIL_FROM || '').trim();
    const timeoutMs = this.resolveTimeoutMs();
    const jmapConfig = this.resolveJmapConfig();
    const smtpUrl = process.env.SMTP_URL?.trim();

    if (!mailFrom || (!jmapConfig && !smtpUrl)) {
      throw new ServiceUnavailableException(
        'Configure JMAP or SMTP_URL and MAIL_FROM to send email',
      );
    }

    let jmapError: unknown = null;
    if (jmapConfig) {
      try {
        return await this.sendViaJmap(
          { ...options, from: mailFrom },
          jmapConfig,
          timeoutMs,
        );
      } catch (err) {
        jmapError = err;
        this.jmapCache = null;
        this.logger.warn(
          `JMAP HTTPS mail delivery failed, ${smtpUrl ? 'falling back to SMTP' : 'no SMTP fallback configured'}: ${(err as Error)?.message ?? err}`,
        );
      }
    }

    if (smtpUrl) {
      try {
        return await this.sendViaSmtp(
          { ...options, from: mailFrom },
          smtpUrl,
          timeoutMs,
        );
      } catch (smtpErr) {
        this.logger.error(
          `SMTP mail delivery failed: ${(smtpErr as Error)?.message ?? smtpErr}`,
        );
        throw new ServiceUnavailableException(
          'Mail delivery service unavailable',
        );
      }
    }

    throw new ServiceUnavailableException(
      `Mail delivery service unavailable: ${(jmapError as Error)?.message ?? jmapError}`,
    );
  }

  private resolveTimeoutMs(): number {
    const raw = Number(process.env.MAIL_TIMEOUT_MS);
    if (Number.isFinite(raw) && raw > 0) {
      return raw;
    }
    return DEFAULT_MAIL_TIMEOUT_MS;
  }

  private resolveJmapConfig(): { url: string; authHeader: string } | null {
    const url = process.env.JMAP_URL?.trim();
    if (!url) return null;

    const token = process.env.JMAP_TOKEN?.trim();
    if (token) {
      return { url, authHeader: `Bearer ${token}` };
    }

    const username = process.env.JMAP_USERNAME?.trim();
    const password = process.env.JMAP_PASSWORD;
    if (username && password) {
      const encoded = Buffer.from(`${username}:${password}`).toString('base64');
      return { url, authHeader: `Basic ${encoded}` };
    }

    return null;
  }

  private parseAddress(raw: string): JmapAddress {
    const trimmed = raw.trim();
    const angleMatch = /^(?:"?([^"]*)"?\s*)?<([^>\s]+@[^>\s]+)>$/.exec(trimmed);
    if (angleMatch) {
      const name = angleMatch[1]?.trim();
      const email = angleMatch[2].trim();
      return name ? { name, email } : { email };
    }
    return { email: trimmed };
  }

  private parseRecipients(to: string | string[]): JmapAddress[] {
    const list = Array.isArray(to)
      ? to
      : to
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
    return list.map((item) => this.parseAddress(item));
  }

  private async getJmapContext(
    jmapUrl: string,
    authHeader: string,
    fromEmail: string,
    timeoutMs: number,
  ): Promise<JmapContext> {
    if (
      this.jmapCache &&
      Date.now() - this.jmapCache.fetchedAt < JMAP_SESSION_TTL_MS
    ) {
      return this.jmapCache;
    }

    const sessionRes = await fetch(jmapUrl, {
      method: 'GET',
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!sessionRes.ok) {
      throw new Error(`JMAP session HTTP ${sessionRes.status}`);
    }

    const session = (await sessionRes.json()) as {
      apiUrl?: string;
      primaryAccounts?: Record<string, string>;
    };
    const apiUrl = session.apiUrl;
    const accountId = session.primaryAccounts?.['urn:ietf:params:jmap:mail'];
    const submissionAccountId =
      session.primaryAccounts?.['urn:ietf:params:jmap:submission'] ?? accountId;

    if (!apiUrl || !accountId || !submissionAccountId) {
      throw new Error('JMAP session missing apiUrl or mail account');
    }

    const metaRes = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        using: [
          'urn:ietf:params:jmap:core',
          'urn:ietf:params:jmap:mail',
          'urn:ietf:params:jmap:submission',
        ],
        methodCalls: [
          ['Mailbox/get', { accountId }, 'm0'],
          ['Identity/get', { accountId: submissionAccountId }, 'i0'],
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!metaRes.ok) {
      throw new Error(`JMAP metadata HTTP ${metaRes.status}`);
    }

    const metaJson = (await metaRes.json()) as {
      methodResponses?: Array<[string, Record<string, any>, string]>;
    };
    const mailboxes: Array<{ id: string; role?: string | null }> =
      metaJson.methodResponses?.[0]?.[1]?.list ?? [];
    const identities: Array<{ id: string; email?: string }> =
      metaJson.methodResponses?.[1]?.[1]?.list ?? [];

    const draftsMailbox =
      mailboxes.find((m) => m.role === 'drafts') ?? mailboxes[0];
    const sentMailbox = mailboxes.find((m) => m.role === 'sent');
    const matchedIdentity =
      identities.find(
        (i) => i.email?.toLowerCase() === fromEmail.toLowerCase(),
      ) ?? identities[0];

    if (!draftsMailbox?.id || !matchedIdentity?.id) {
      throw new Error('JMAP account missing drafts mailbox or sender identity');
    }

    this.jmapCache = {
      apiUrl,
      accountId,
      submissionAccountId,
      draftsMailboxId: draftsMailbox.id,
      sentMailboxId: sentMailbox?.id,
      identityId: matchedIdentity.id,
      fetchedAt: Date.now(),
    };
    return this.jmapCache;
  }

  private async sendViaJmap(
    options: SendMailOptions & { from: string },
    config: { url: string; authHeader: string },
    timeoutMs: number,
  ): Promise<unknown> {
    const fromAddr = this.parseAddress(options.from);
    const toAddrs = this.parseRecipients(options.to);
    if (toAddrs.length === 0) {
      throw new Error('Recipient address is required');
    }

    const ctx = await this.getJmapContext(
      config.url,
      config.authHeader,
      fromAddr.email,
      timeoutMs,
    );

    const bodyValues: Record<string, { value: string }> = {};
    const emailPayload: Record<string, unknown> = {
      mailboxIds: { [ctx.draftsMailboxId]: true },
      from: [fromAddr],
      to: toAddrs,
      subject: options.subject,
      keywords: { $draft: true },
      bodyValues,
    };

    if (options.replyTo) {
      emailPayload.replyTo = [this.parseAddress(options.replyTo)];
    }

    const textContent = options.text ?? '';
    if (textContent || !options.html) {
      bodyValues.text = { value: textContent };
      emailPayload.textBody = [{ partId: 'text', type: 'text/plain' }];
    }
    if (options.html) {
      bodyValues.html = { value: options.html };
      emailPayload.htmlBody = [{ partId: 'html', type: 'text/html' }];
    }

    const onSuccessPatch: Record<string, unknown> = {
      [`mailboxIds/${ctx.draftsMailboxId}`]: null,
      'keywords/$draft': null,
      'keywords/$seen': true,
    };
    if (ctx.sentMailboxId) {
      onSuccessPatch[`mailboxIds/${ctx.sentMailboxId}`] = true;
    }

    const res = await fetch(ctx.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: config.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        using: [
          'urn:ietf:params:jmap:core',
          'urn:ietf:params:jmap:mail',
          'urn:ietf:params:jmap:submission',
        ],
        methodCalls: [
          [
            'Email/set',
            {
              accountId: ctx.accountId,
              create: { draft1: emailPayload },
            },
            'e0',
          ],
          [
            'EmailSubmission/set',
            {
              accountId: ctx.submissionAccountId,
              create: {
                sub1: {
                  identityId: ctx.identityId,
                  emailId: '#draft1',
                  envelope: {
                    mailFrom: { email: fromAddr.email, parameters: null },
                    rcptTo: toAddrs.map((r) => ({
                      email: r.email,
                      parameters: null,
                    })),
                  },
                },
              },
              onSuccessUpdateEmail: {
                '#sub1': onSuccessPatch,
              },
            },
            's0',
          ],
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`JMAP submission HTTP ${res.status}`);
    }

    const body = (await res.json()) as {
      methodResponses?: Array<[string, Record<string, any>, string]>;
    };
    const responses = body.methodResponses ?? [];
    for (const [name, payload] of responses) {
      if (name === 'error') {
        throw new Error(`JMAP error: ${JSON.stringify(payload)}`);
      }
      if (payload?.notCreated && Object.keys(payload.notCreated).length > 0) {
        throw new Error(
          `JMAP ${name} rejected: ${JSON.stringify(payload.notCreated)}`,
        );
      }
    }

    return body;
  }

  private async sendViaSmtp(
    options: SendMailOptions & { from: string },
    smtpUrl: string,
    timeoutMs: number,
  ): Promise<unknown> {
    if (!this.smtpTransporter || this.smtpUrlCached !== smtpUrl) {
      this.smtpTransporter?.close?.();
      this.smtpTransporter = nodemailer.createTransport({
        url: smtpUrl,
        pool: true,
        connectionTimeout: timeoutMs,
        greetingTimeout: timeoutMs,
        socketTimeout: timeoutMs,
      });
      this.smtpUrlCached = smtpUrl;
    }

    return this.smtpTransporter.sendMail({
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      from: options.from,
      replyTo: options.replyTo,
    });
  }
}
