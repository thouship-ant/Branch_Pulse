import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { spawn } from 'node:child_process';
import { addDays, fmtDate, toDate, todayIST } from '../common/dates';
import { env } from '../config/env';

/**
 * Development / demo only. Every day at 17:00 IST it tops up the demo company (DEMO_DATA_COMPANY, default CMP000) with dummy data for the
 * last few days up to today - sales, expenses, cash, purchases, wastage, stock movements, attendance and salary - by running the same
 * seed scripts used by hand (prisma/seed-range.ts, seed-extras.ts, seed-attendance.ts). They are idempotent: days that already have data
 * are left alone, and an approved (locked) day is never touched.
 *
 * Switched on with DEMO_DATA_CRON=true. It refuses to run in production, so a real company is never filled with fake figures.
 */
@Injectable()
export class DemoDataService {
  private readonly log = new Logger(DemoDataService.name);
  private running = false;

  @Cron('0 17 * * *', { timeZone: 'Asia/Kolkata' })
  async daily() {
    if (!env.demo.enabled) return;
    await this.run();
  }

  /** Also callable by hand (e.g. from a REPL or a script). Returns false when it was skipped. */
  async run(): Promise<boolean> {
    if (env.isProd) { this.log.warn('Demo data generation is disabled in production'); return false; }
    if (this.running) { this.log.warn('Demo data generation is already running'); return false; }
    this.running = true;
    const today = todayIST();
    const from = fmtDate(addDays(toDate(today), -3));
    const company = env.demo.company;
    try {
      this.log.log(`Generating demo data for ${company}: ${from}..${today}`);
      await this.script('prisma/seed-range.ts', ['--company', company, '--from', from, '--to', today]);
      await this.script('prisma/seed-extras.ts', ['--company', company, '--from', from, '--to', today]);
      await this.script('prisma/seed-attendance.ts', ['--company', company, '--from', fmtDate(addDays(toDate(today), -35))]);
      this.log.log('Demo data generation finished');
      return true;
    } catch (err) {
      this.log.error(`Demo data generation failed: ${err instanceof Error ? err.message : err}`);
      return false;
    } finally {
      this.running = false;
    }
  }

  private script(file: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const win = process.platform === 'win32';
      const child = spawn(win ? 'npx.cmd' : 'npx', ['tsx', file, ...args], { cwd: process.cwd(), shell: win, env: process.env });
      let tail = '';
      child.stdout.on('data', (d) => { tail = (tail + d.toString()).slice(-400); });
      child.stderr.on('data', (d) => { tail = (tail + d.toString()).slice(-400); });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${file} exited with ${code}: ${tail.trim().split('\n').pop()}`))));
    });
  }
}
