import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';

/**
 * Sends transactional SMS through SMS Fortius (an HTTP GET API; the sender id and template id come from the DLT
 * registration). Same provider and parameters as the Daily Meat backend. When the gateway is not configured the
 * message is only logged, so local development works without credentials.
 */
@Injectable()
export class SmsService {
  private readonly log = new Logger('SMS');

  get configured(): boolean {
    const { apiKey, senderId, templateId, baseUrl } = env.sms;
    return !!(apiKey && senderId && templateId && baseUrl);
  }

  /** @returns true when the gateway accepted the message, false when it is not configured (logged only) */
  private async send(mobile: string, templateId: string | undefined, message: string, logLine: string): Promise<boolean> {
    const { apiKey, senderId, baseUrl } = env.sms;
    if (!apiKey || !senderId || !templateId || !baseUrl) {
      this.log.warn(`SMS Fortius is not configured: ${logLine} (development only)`);
      return false;
    }
    const params = new URLSearchParams({
      apikey: apiKey,
      senderid: senderId,
      templateid: templateId,
      number: mobile.replace(/^\+?91/, ''),
      message,
    });
    const res = await fetch(`${baseUrl}?${params.toString()}`, { method: 'GET', signal: AbortSignal.timeout(10_000) });
    const body = await res.text();
    if (!res.ok) throw new Error(`SMS Fortius returned ${res.status}`);
    this.log.log(`SMS sent to ${mobile.slice(0, 2)}******${mobile.slice(-2)}: ${body.slice(0, 120)}`);
    return true;
  }

  async sendOtp(mobile: string, otp: string, user: string): Promise<void> {
    await this.send(mobile, env.sms.templateId, env.sms.otpTemplate.replace('{user}', user).replace('{otp}', otp), `OTP for ${user} (${mobile}) is ${otp}`);
  }

  /** The temporary password a Super Admin reset sends to the user. */
  sendTempPassword(mobile: string, password: string, user: string): Promise<boolean> {
    return this.send(mobile, env.sms.tempPasswordTemplateId, env.sms.tempPasswordTemplate.replace('{user}', user).replace('{password}', password), `temporary password for ${user} (${mobile}) is ${password}`);
  }
}
