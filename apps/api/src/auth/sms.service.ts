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

  async sendOtp(mobile: string, otp: string): Promise<void> {
    const { apiKey, senderId, templateId, baseUrl, otpTemplate } = env.sms;
    if (!apiKey || !senderId || !templateId || !baseUrl) {
      this.log.warn(`SMS Fortius is not configured: OTP for ${mobile} is ${otp} (development only)`);
      return;
    }
    const params = new URLSearchParams({
      apikey: apiKey,
      senderid: senderId,
      templateid: templateId,
      number: mobile.replace(/^\+?91/, ''),
      message: otpTemplate.replace('{otp}', otp),
    });
    const res = await fetch(`${baseUrl}?${params.toString()}`, { method: 'GET', signal: AbortSignal.timeout(10_000) });
    const body = await res.text();
    if (!res.ok) throw new Error(`SMS Fortius returned ${res.status}`);
    this.log.log(`OTP sent to ${mobile.slice(0, 2)}******${mobile.slice(-2)}: ${body.slice(0, 120)}`);
  }
}
