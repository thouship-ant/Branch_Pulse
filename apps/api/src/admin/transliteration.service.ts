import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../common/settings.service';
import { hasTamil, toTamilLocal } from './tamil-local';

export interface Transliteration {
  tamil: string;
  /** google = external transliteration service; local = built-in approximation */
  source: 'google' | 'local';
}

/**
 * English -> Tamil for master-data names (branches). Primary source is Google Input Tools' public
 * transliteration endpoint, called from THIS server (never from the browser), with a short timeout; if it is
 * unreachable, disabled (`transliteration.external` = false) or returns nothing, the built-in fallback is used
 * so saving a branch never depends on the internet. Only the text being transliterated leaves the server.
 */
@Injectable()
export class TransliterationService {
  private readonly log = new Logger(TransliterationService.name);

  constructor(private readonly settings: SettingsService) {}

  async toTamil(input: string): Promise<Transliteration> {
    const text = input.trim().replace(/\s+/g, ' ').slice(0, 100);
    if (!text) return { tamil: '', source: 'local' };
    if (hasTamil(text)) return { tamil: text, source: 'local' }; // already Tamil

    if (await this.settings.get<boolean>('transliteration.external')) {
      try {
        const tamil = await this.google(text);
        if (tamil) return { tamil, source: 'google' };
      } catch (e) {
        this.log.warn(`external transliteration unavailable, using fallback: ${(e as Error).message}`);
      }
    }
    return { tamil: toTamilLocal(text), source: 'local' };
  }

  private async google(text: string): Promise<string | null> {
    const url =
      'https://inputtools.google.com/request?itc=ta-t-i0-und&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8&app=demopage&text=' +
      encodeURIComponent(text);
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as unknown;
    // ["SUCCESS", [[ "<input>", ["<tamil>"], ... ]]]
    if (!Array.isArray(body) || body[0] !== 'SUCCESS') return null;
    const first = (body[1] as unknown[][])?.[0]?.[1] as unknown;
    const tamil = Array.isArray(first) ? first[0] : null;
    return typeof tamil === 'string' && hasTamil(tamil) ? tamil.slice(0, 100) : null;
  }
}
