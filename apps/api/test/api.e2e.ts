import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { addDaysStr, todayIST } from '../src/common/dates';
import { PrismaService } from '../src/common/prisma.service';
import { configureApp } from '../src/setup';

const PASSWORD = 'ChangeMe@123'; // seed password
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Branch Pulse API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  const today = todayIST();
  const yesterday = addDaysStr(today, -1);
  const rnd = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');

  let owner: string; // access tokens
  let manager: string;
  let ownLoc: string; // branch created for this run
  let otherLoc: string; // seeded BR001
  let closingId: string;
  let smallExpenseId: string;
  let bigExpenseId: string;

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = async (username: string, password = PASSWORD) =>
    http().post('/api/v1/auth/login').send({ username, password });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    owner = (await login('owner')).body.data.accessToken;

    const locs = (await http().get('/api/v1/locations').set(as(owner))).body.data as Array<{ id: string; code: string }>;
    otherLoc = locs.find((l) => l.code === 'BR001')!.id;

    // a fresh branch + manager per run keeps the suite repeatable
    const created = await http()
      .post('/api/v1/locations')
      .set(as(owner))
      .send({ code: `T${rnd}`, name: `Test Branch ${rnd}`, type: 'BRANCH', defaultOpeningCash: '2000.00' });
    expect(created.status).toBe(201);
    ownLoc = created.body.data.id;

    const user = await http()
      .post('/api/v1/users')
      .set(as(owner))
      .send({ username: `mgr${rnd}`, password: 'Test@12345', fullName: 'Test Manager', roleCodes: ['BRANCH_MANAGER'], locationIds: [ownLoc] });
    expect(user.status).toBe(201);
    manager = (await login(`mgr${rnd}`, 'Test@12345')).body.data.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  // ------------------------------------------------------------------ authentication
  describe('authentication', () => {
    it('rejects requests without a token', async () => {
      const res = await http().get('/api/v1/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('the health check is public', async () => {
      const res = await http().get('/api/v1/health');
      expect(res.status).toBe(200);
    });

    it('exposes only the manager\'s own branch on /me', async () => {
      const res = await http().get('/api/v1/me').set(as(manager));
      expect(res.status).toBe(200);
      expect(res.body.data.locations.map((l: { id: string }) => l.id)).toEqual([ownLoc]);
      expect(res.body.data.permissions).toContain('closing:submit');
      expect(res.body.data.permissions).not.toContain('closing:approve');
    });

    it('locks the account after 5 failed attempts (even with the right password afterwards)', async () => {
      await http().post('/api/v1/users').set(as(owner)).send({
        username: `lock${rnd}`, password: 'Test@12345', fullName: 'Lock Test', roleCodes: ['BRANCH_MANAGER'], locationIds: [ownLoc],
      });
      for (let i = 0; i < 5; i++) {
        const bad = await login(`lock${rnd}`, 'wrong-password');
        expect(bad.status).toBe(401);
        expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
      }
      const locked = await login(`lock${rnd}`, 'Test@12345');
      expect(locked.status).toBe(423);
      expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    });

    it('sets an HttpOnly, SameSite=Strict refresh cookie and rotates it', async () => {
      // logins are limited to 10/min/IP, so reuse the session created for the manager via a fresh owner login
      const res = await login('accountant');
      const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
      expect(cookie).toMatch(/bp_refresh=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);

      const refreshed = await http().post('/api/v1/auth/refresh').set('Cookie', cookie.split(';')[0]);
      expect(refreshed.status).toBe(200);
      expect(refreshed.body.data.accessToken).toBeTruthy();

      // replaying the OLD cookie after rotation is treated as theft: session is revoked
      const replay = await http().post('/api/v1/auth/refresh').set('Cookie', cookie.split(';')[0]);
      expect(replay.status).toBe(401);
      const afterTheft = await http().get('/api/v1/me').set(as(refreshed.body.data.accessToken));
      expect(afterTheft.status).toBe(401); // whole session dead, incl. the access token
    });
  });

  // ------------------------------------------------------------------ branch isolation (HLD s3)
  describe('branch isolation', () => {
    beforeAll(async () => {
      // give the OTHER branch some data so a leak would be visible
      const categoryId = (await http().get('/api/v1/expense-categories').set(as(owner))).body.data[0].id;
      await http()
        .post('/api/v1/expenses')
        .set(as(owner))
        .send({ locationId: otherLoc, businessDate: today, paymentMode: 'CASH', amount: '100.00', categoryId })
        .expect(201);
    });

    it('layer 2: 403 when a manager names another branch in the query, path or body', async () => {
      const query = await http().get(`/api/v1/daily-sales?locationId=${otherLoc}&date=${today}`).set(as(manager));
      const path = await http().get(`/api/v1/cash/reconciliation/${otherLoc}/${today}`).set(as(manager));
      const body = await http()
        .post('/api/v1/expenses')
        .set(as(manager))
        .send({ locationId: otherLoc, businessDate: today, categoryId: randomUUID(), amount: '10', paymentMode: 'CASH' });
      for (const res of [query, path, body]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN_LOCATION');
      }
    });

    it('layer 3/4: a manager listing all expenses sees none from another branch', async () => {
      const res = await http().get('/api/v1/expenses').set(as(manager));
      expect(res.status).toBe(200);
      expect(res.body.data.every((e: { locationId: string }) => e.locationId === ownLoc)).toBe(true);
    });

    it('layer 4: RLS alone blocks other branches even when application scoping is bypassed', async () => {
      // raw Prisma, no service, no where-clause scoping: only PostgreSQL can stop this
      const mine = await prisma.runScoped({ all: false, locationIds: [ownLoc] }, (tx) => tx.expense.findMany());
      expect(mine.every((e) => e.location_id === ownLoc)).toBe(true);

      const wrongBranch = await prisma.runScoped({ all: false, locationIds: [ownLoc] }, (tx) =>
        tx.expense.findMany({ where: { location_id: otherLoc } }),
      );
      expect(wrongBranch).toEqual([]);

      const all = await prisma.runScoped({ all: true, locationIds: [] }, (tx) => tx.expense.count({ where: { location_id: otherLoc } }));
      expect(all).toBeGreaterThan(0); // the data really is there

      // deny by default: no scope variables at all -> nothing
      expect(await prisma.expense.count()).toBe(0);
    });

    it('layer 4: RLS also blocks writing into another branch', async () => {
      const cat = await prisma.expenseCategory.findFirstOrThrow();
      await expect(
        prisma.runScoped({ all: false, locationIds: [ownLoc] }, (tx) =>
          tx.expense.create({
            data: {
              code: `X-${rnd}`, location_id: otherLoc, business_date: new Date(`${today}T00:00:00Z`), category_id: cat.id,
              amount: '1', payment_mode: 'CASH', entered_by: randomUUID(),
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it('permissions: managers cannot manage users or approve closings', async () => {
      expect((await http().get('/api/v1/users').set(as(manager))).status).toBe(403);
      const res = await http().post(`/api/v1/closings/${randomUUID()}/approve`).set(as(manager)).send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // ------------------------------------------------------------------ the daily loop
  describe('daily sales, expenses, cash and closing', () => {
    let categoryId: string;
    let salesVersion: number;

    beforeAll(async () => {
      categoryId = (await http().get('/api/v1/expense-categories').set(as(manager))).body.data[0].id;
    });

    it('saves the day\'s sales; a split that does not add up saves with a warning', async () => {
      const put = (body: object) =>
        http().put(`/api/v1/daily-sales?locationId=${ownLoc}&date=${today}`).set(as(manager)).send(body);

      const first = await put({ totalSales: '30000.00', cashSales: '12000.00', upiSales: '17000.00', cardSales: '500.00' });
      expect(first.status).toBe(200);
      expect(first.body.warnings.map((w: { code: string }) => w.code)).toContain('SALES_SPLIT_MISMATCH');
      expect(first.body.data.mismatchAmount).toBe('500');
      salesVersion = first.body.data.version;

      // stale version is refused (V26)
      const stale = await put({ totalSales: '30000.00', cashSales: '12000.00', upiSales: '17000.00', cardSales: '1000.00', version: 99 });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('STALE_VERSION');

      const fixed = await put({ totalSales: '30000.00', cashSales: '12000.00', upiSales: '17000.00', cardSales: '1000.00', version: salesVersion });
      expect(fixed.status).toBe(200);
      expect(fixed.body.warnings).toEqual([]);
      salesVersion = fixed.body.data.version;
    });

    it('rejects malformed money and future dates', async () => {
      const badAmount = await http().put(`/api/v1/daily-sales?locationId=${ownLoc}&date=${today}`).set(as(manager)).send({ totalSales: '12.345' });
      expect(badAmount.status).toBe(422);

      const future = await http()
        .put(`/api/v1/daily-sales?locationId=${ownLoc}&date=${addDaysStr(today, 1)}`)
        .set(as(manager))
        .send({ totalSales: '100' });
      expect(future.status).toBe(422);
      expect(future.body.error.code).toBe('DATE_OUT_OF_RANGE');
    });

    it('auto-approves a small expense and books it to the till', async () => {
      const res = await http().post('/api/v1/expenses').set(as(manager)).send({
        locationId: ownLoc, businessDate: today, categoryId, amount: '300.00', paymentMode: 'CASH', payeeName: 'Milk vendor',
      });
      expect(res.status).toBe(201);
      expect(res.body.data.approvalStatus).toBe('APPROVED'); // <= branch manager limit of 500
      expect(res.body.data.code).toMatch(/^EXP-T\d+-\d\d-\d{6}$/);
      smallExpenseId = res.body.data.id;
    });

    it('requires a receipt photo above the threshold (V12)', async () => {
      const res = await http().post('/api/v1/expenses').set(as(manager)).send({
        locationId: ownLoc, businessDate: today, categoryId, amount: '800.00', paymentMode: 'CASH',
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('RECEIPT_REQUIRED');
    });

    it('uploads a receipt through a presigned URL and sends an over-limit expense for approval', async () => {
      const presign = await http().post('/api/v1/attachments/presign').set(as(manager)).send({
        fileName: 'bill.png', mimeType: 'image/png', sizeBytes: PNG.length, locationId: ownLoc,
      });
      expect(presign.status).toBe(201);
      const { key, uploadUrl } = presign.body.data;

      // content that is not really a PNG is refused
      const fake = await http().put(uploadUrl).set('Content-Type', 'image/png').send(Buffer.from('not an image at all'));
      expect(fake.status).toBe(422);
      // a tampered signature is refused
      const tampered = await http().put(uploadUrl.replace(/sig=[0-9a-f]+/, 'sig=deadbeef')).set('Content-Type', 'image/png').send(PNG);
      expect(tampered.status).toBe(403);

      const up = await http().put(uploadUrl).set('Content-Type', 'image/png').send(PNG);
      expect(up.status).toBe(200);

      const res = await http().post('/api/v1/expenses').set(as(manager)).send({
        locationId: ownLoc, businessDate: today, categoryId, amount: '800.00', paymentMode: 'CASH', attachmentKeys: [key],
      });
      expect(res.status).toBe(201);
      expect(res.body.data.approvalStatus).toBe('SUBMITTED'); // above the manager's 500 limit
      bigExpenseId = res.body.data.id;

      const detail = await http().get(`/api/v1/expenses/${bigExpenseId}`).set(as(manager));
      expect(detail.body.data.attachments).toHaveLength(1);

      // another user's key cannot be claimed
      const stolen = await http().post('/api/v1/expenses').set(as(owner)).send({
        locationId: ownLoc, businessDate: today, categoryId, amount: '900.00', paymentMode: 'CASH', attachmentKeys: [key],
      });
      expect(stolen.status).toBe(422);
    });

    it('computes expected cash from the day\'s cash movements (LLD 9.2)', async () => {
      const res = await http().get(`/api/v1/cash/reconciliation/${ownLoc}/${today}`).set(as(manager));
      expect(res.status).toBe(200);
      // opening 2,000 + cash sales 12,000 - expenses (300 + 800)
      expect(res.body.data.openingCash).toBe('2000');
      expect(res.body.data.cashSales).toBe('12000');
      expect(res.body.data.cashExpenses).toBe('1100');
      expect(res.body.data.expectedClosing).toBe('12900');
    });

    it('blocks submit until the cash is counted, then until a variance is explained', async () => {
      const screen = await http().get(`/api/v1/closings/${ownLoc}/${today}`).set(as(manager));
      expect(screen.status).toBe(200);
      closingId = screen.body.data.closing.id;
      expect(screen.body.data.closing.status).toBe('PENDING');
      expect(screen.body.data.canSubmit).toBe(false);

      const noCount = await http().post(`/api/v1/closings/${closingId}/submit`).set(as(manager)).send({});
      expect(noCount.status).toBe(422);
      expect(noCount.body.error.code).toBe('CLOSING_PRECHECK_FAILED');
      expect(noCount.body.error.details.map((c: { code: string }) => c.code)).toContain('CASH_COUNTED');

      // count 300 short, no reason yet
      const save = await http().put(`/api/v1/cash/reconciliation/${ownLoc}/${today}`).set(as(manager)).send({ actualClosing: '12600.00' });
      expect(save.status).toBe(200);
      expect(save.body.data.variance).toBe('-300');
      expect(save.body.data.varianceLabel).toBe('SHORTAGE');

      const noReason = await http().post(`/api/v1/closings/${closingId}/submit`).set(as(manager)).send({});
      expect(noReason.status).toBe(422);
      expect(noReason.body.error.details.map((c: { code: string }) => c.code)).toEqual(['VARIANCE_EXPLAINED']);
    });

    it('submits once everything is in order, then freezes the branch user out of edits', async () => {
      await http().put(`/api/v1/cash/reconciliation/${ownLoc}/${today}`).set(as(manager)).send({
        varianceReason: 'SHORT_CHANGE', managerExplanation: 'Gave wrong change during the evening rush',
        denominations: { '500': 20, '100': 20, '50': 12 },
      }).expect(200);

      const submit = await http().post(`/api/v1/closings/${closingId}/submit`).set(as(manager)).send({ remarks: 'Busy day' });
      expect(submit.status).toBe(200);
      expect(submit.body.data.status).toBe('SUBMITTED');
      expect(submit.body.data.totalSales).toBe('30000');
      expect(submit.body.data.cashVariance).toBe('-300'); // snapshot frozen at submit

      const edit = await http().put(`/api/v1/daily-sales?locationId=${ownLoc}&date=${today}`).set(as(manager)).send({ totalSales: '31000', version: salesVersion });
      expect(edit.status).toBe(409);
      expect(edit.body.error.code).toBe('DAY_SUBMITTED');

      const again = await http().post(`/api/v1/closings/${closingId}/submit`).set(as(manager)).send({});
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('INVALID_TRANSITION');
    });

    it('surfaces the cash shortage and the waiting expense to the owner', async () => {
      const ex = await http().get('/api/v1/exceptions').set(as(owner));
      expect(ex.status).toBe(200);
      const mine = ex.body.data.filter((e: { locationId: string }) => e.locationId === ownLoc);
      expect(mine.map((e: { code: string }) => e.code)).toContain('CASH_SHORTAGE');
      // items carry a stable group key (translated by the UI) and the Tamil branch name field
      const shortage = mine.find((e: { code: string }) => e.code === 'CASH_SHORTAGE');
      expect(shortage.groupKey).toBe('CASH_SHORTAGE');
      expect(shortage).toHaveProperty('locationNameTa');

      const seeded = ex.body.data.filter((e: { locationName: string }) => e.locationName === 'Anna Nagar');
      for (const e of seeded) expect(e.locationNameTa).toBe('அண்ணா நகர்');

      const board = await http().get(`/api/v1/closings?date=${today}`).set(as(owner));
      const row = board.body.data.find((r: { locationId: string }) => r.locationId === ownLoc);
      expect(row.status).toBe('SUBMITTED');
    });

    it('the owner cannot approve the day while an expense is still waiting', async () => {
      const res = await http().post(`/api/v1/closings/${closingId}/approve`).set(as(owner)).send({});
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CLOSING_HAS_PENDING_ITEMS');
    });

    it('approval limits: an accountant can approve 800, but not what exceeds 25,000', async () => {
      const acc = (await login('accountant')).body.data.accessToken;
      // 800 is within the accountant's 25,000 limit
      const ok = await http().post(`/api/v1/expenses/${bigExpenseId}/approve`).set(as(acc));
      expect(ok.status).toBe(200);
      expect(ok.body.data.approvalStatus).toBe('APPROVED');

      const receipt = await http().post('/api/v1/attachments/presign').set(as(owner)).send({
        fileName: 'b.png', mimeType: 'image/png', sizeBytes: PNG.length, locationId: ownLoc,
      });
      await http().put(receipt.body.data.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
      const huge = await http().post('/api/v1/expenses').set(as(owner)).send({
        locationId: ownLoc, businessDate: yesterday, categoryId, amount: '50000.00', paymentMode: 'BANK_TRANSFER',
        attachmentKeys: [receipt.body.data.key],
      });
      expect(huge.body.data.approvalStatus).toBe('APPROVED'); // owner is unlimited
    });

    it('the owner approves the closing, which locks the whole branch-day', async () => {
      const res = await http().post(`/api/v1/closings/${closingId}/approve`).set(as(owner)).send({ comment: 'ok' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('APPROVED');

      // application rule
      const sales = await http().put(`/api/v1/daily-sales?locationId=${ownLoc}&date=${today}`).set(as(manager)).send({ totalSales: '31000', version: salesVersion });
      expect(sales.status).toBe(409);
      expect(sales.body.error.code).toBe('DAY_LOCKED');
      const expense = await http().post('/api/v1/expenses').set(as(manager)).send({ locationId: ownLoc, businessDate: today, categoryId, amount: '50', paymentMode: 'CASH' });
      expect(expense.status).toBe(409);
      expect(expense.body.error.code).toBe('DAY_LOCKED');

      // database trigger: even a privileged raw write cannot change a locked day
      await expect(
        prisma.runScoped({ all: true, locationIds: [] }, (tx) =>
          tx.expense.update({ where: { id: smallExpenseId }, data: { description: 'tamper' } }),
        ),
      ).rejects.toThrow(/DAY_LOCKED/);
      // ...and approved amounts are immutable
      await expect(
        prisma.runScoped({ all: true, locationIds: [] }, (tx) =>
          tx.expense.update({ where: { id: smallExpenseId }, data: { amount: '1.00' } }),
        ),
      ).rejects.toThrow(/DAY_LOCKED|APPROVED_IMMUTABLE/);
    });

    it('the app role cannot delete or rewrite history', async () => {
      await expect(prisma.runScoped({ all: true, locationIds: [] }, (tx) => tx.auditLog.deleteMany())).rejects.toThrow();
      await expect(prisma.runScoped({ all: true, locationIds: [] }, (tx) => tx.auditLog.updateMany({ data: { reason: 'x' } }))).rejects.toThrow();
      await expect(prisma.runScoped({ all: true, locationIds: [] }, (tx) => tx.expense.deleteMany())).rejects.toThrow();
    });

    it('reopen needs the owner and a reason; then the manager can correct and resubmit', async () => {
      const byManager = await http().post(`/api/v1/closings/${closingId}/reopen`).set(as(manager)).send({ comment: 'please' });
      expect(byManager.status).toBe(403);

      const noReason = await http().post(`/api/v1/closings/${closingId}/reopen`).set(as(owner)).send({});
      expect(noReason.status).toBe(422);
      expect(noReason.body.error.code).toBe('REASON_REQUIRED');

      const reopen = await http().post(`/api/v1/closings/${closingId}/reopen`).set(as(owner)).send({ comment: 'Wrong UPI figure' });
      expect(reopen.status).toBe(200);
      expect(reopen.body.data.status).toBe('REOPENED');
      expect(reopen.body.data.reopenCount).toBe(1);

      const current = await http().get(`/api/v1/daily-sales?locationId=${ownLoc}&date=${today}`).set(as(manager));
      const fix = await http().put(`/api/v1/daily-sales?locationId=${ownLoc}&date=${today}`).set(as(manager)).send({
        totalSales: '31000.00', cashSales: '12000.00', upiSales: '18000.00', cardSales: '1000.00', version: current.body.data.version,
      });
      expect(fix.status).toBe(200);

      const resubmit = await http().post(`/api/v1/closings/${closingId}/submit`).set(as(manager)).send({});
      expect(resubmit.status).toBe(200);
      expect(resubmit.body.data.totalSales).toBe('31000');
    });

    it('reversal of an approved expense keeps the original and re-credits the till (never a delete)', async () => {
      // the day is open again (REOPENED) so today-dated mirror postings are allowed after re-approval too
      const noReason = await http().post(`/api/v1/expenses/${smallExpenseId}/reverse`).set(as(owner)).send({});
      expect(noReason.status).toBe(422);

      const acc = (await login('accountant')).body.data.accessToken;
      const denied = await http().post(`/api/v1/expenses/${smallExpenseId}/reverse`).set(as(manager)).send({ reason: 'oops' });
      expect(denied.status).toBe(403);

      const rev = await http().post(`/api/v1/expenses/${smallExpenseId}/reverse`).set(as(acc)).send({ reason: 'Duplicate entry' });
      expect(rev.status).toBe(200);
      expect(rev.body.data.status).toBe('REVERSED');

      const still = await http().get(`/api/v1/expenses/${smallExpenseId}`).set(as(owner));
      expect(still.status).toBe(200); // original stays visible
      const txns = await http().get(`/api/v1/cash/transactions?locationId=${ownLoc}&date=${today}`).set(as(owner));
      expect(txns.body.data.some((t: { sourceType: string }) => t.sourceType === 'EXPENSE_REVERSAL')).toBe(true);
    });

    it('figures that moved after submission cannot be approved: reject, recount, resubmit, approve', async () => {
      // the reversal above changed expected cash AFTER the manager submitted, so the snapshot is stale
      const stale = await http().post(`/api/v1/closings/${closingId}/approve`).set(as(owner)).send({});
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('CLOSING_FIGURES_CHANGED');
      expect(stale.body.error.details.changed).toContain('expectedCash');

      const noComment = await http().post(`/api/v1/closings/${closingId}/reject`).set(as(owner)).send({});
      expect(noComment.status).toBe(422); // comment mandatory
      await http().post(`/api/v1/closings/${closingId}/reject`).set(as(owner)).send({ comment: 'Recount please' }).expect(200);

      const recon = await http().get(`/api/v1/cash/reconciliation/${ownLoc}/${today}`).set(as(manager));
      expect(recon.body.data.expectedClosing).toBe('13200'); // 12,900 + 300 re-credited
      await http().put(`/api/v1/cash/reconciliation/${ownLoc}/${today}`).set(as(manager)).send({ actualClosing: '13200.00', version: recon.body.data.version }).expect(200);

      await http().post(`/api/v1/closings/${closingId}/submit`).set(as(manager)).send({}).expect(200);
      await http().post(`/api/v1/closings/${closingId}/approve`).set(as(owner)).send({}).expect(200);

      const events = await http().get(`/api/v1/closings/${closingId}/events`).set(as(owner));
      expect(events.body.data.map((e: { toStatus: string }) => e.toStatus)).toEqual([
        'SUBMITTED', 'APPROVED', 'REOPENED', 'SUBMITTED', 'REJECTED', 'SUBMITTED', 'APPROVED',
      ]);

      const audit = await prisma.runScoped({ all: true, locationIds: [] }, (tx) =>
        tx.auditLog.findMany({ where: { entity_type: 'DAILY_CLOSING', entity_id: closingId } }),
      );
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['STATUS_CHANGE', 'APPROVE', 'REOPEN', 'REJECT']));
      const reopenRow = audit.find((a) => a.action === 'REOPEN')!;
      expect(reopenRow.reason).toBe('Wrong UPI figure');
      expect(reopenRow.actor_role).toBe('OWNER');
    });

    it('never stores or returns password hashes, and masks secrets in the audit log', async () => {
      const users = await http().get('/api/v1/users').set(as(owner));
      expect(JSON.stringify(users.body)).not.toMatch(/passwordHash|password_hash|\$argon2/);
      const rows = await prisma.runScoped({ all: true, locationIds: [] }, (tx) =>
        tx.auditLog.findMany({ where: { entity_type: 'USER', action: 'CREATE' } }),
      );
      expect(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toMatch(/\$argon2/);
    });
  });

  // ------------------------------------------------------------------ offline sync (HLD s7, LLD s15)
  describe('offline sync', () => {
    let categoryId: string;
    const opUuid = randomUUID();

    beforeAll(async () => {
      categoryId = (await http().get('/api/v1/expense-categories').set(as(manager))).body.data[0].id;
    });

    const batch = (operations: object[]) =>
      http().post('/api/v1/sync/batch').set(as(manager)).set('X-Device-Id', 'pwa-test').send({ deviceId: 'pwa-test', operations });

    const expenseOp = (clientUuid: string, amount = '120.00') => ({
      clientUuid, entityType: 'EXPENSE', op: 'CREATE', clientCreatedAt: new Date().toISOString(),
      payload: { locationId: ownLoc, businessDate: yesterday, categoryId, amount, paymentMode: 'CASH' },
    });

    it('applies a queued expense exactly once, however often the batch is replayed', async () => {
      const first = await batch([expenseOp(opUuid)]);
      expect(first.status).toBe(200);
      expect(first.body.data.results[0].result).toBe('APPLIED');

      for (let i = 0; i < 3; i++) {
        const replay = await batch([expenseOp(opUuid)]);
        expect(replay.body.data.results[0].result).toBe('DUPLICATE');
        expect(replay.body.data.results[0].entityId).toBe(first.body.data.results[0].entityId);
      }
      const count = await prisma.runScoped({ all: true, locationIds: [] }, (tx) => tx.expense.count({ where: { client_uuid: opUuid } }));
      expect(count).toBe(1);

      const row = await prisma.runScoped({ all: true, locationIds: [] }, (tx) => tx.expense.findFirstOrThrow({ where: { client_uuid: opUuid } }));
      expect(row.source).toBe('PWA_OFFLINE');
    });

    it('a second device entering the same day\'s sales becomes a conflict, never an overwrite', async () => {
      const sales = (clientUuid: string, total: string) => ({
        clientUuid, entityType: 'DAILY_SALES', op: 'CREATE',
        payload: { locationId: ownLoc, businessDate: yesterday, totalSales: total, cashSales: total },
      });
      const a = await batch([sales(randomUUID(), '20000.00')]);
      expect(a.body.data.results[0].result).toBe('APPLIED');
      const b = await batch([sales(randomUUID(), '99999.00')]);
      expect(b.body.data.results[0].result).toBe('CONFLICT');
      expect(b.body.data.results[0].server.totalSales).toBe('20000');
    });

    it('an entry for an approved (locked) day is rejected with DAY_LOCKED', async () => {
      const res = await batch([{ ...expenseOp(randomUUID()), payload: { locationId: ownLoc, businessDate: today, categoryId, amount: '50.00', paymentMode: 'CASH' } }]);
      expect(res.body.data.results[0].result).toBe('REJECTED');
      expect(res.body.data.results[0].error.code).toBe('DAY_LOCKED');
    });

    it('rejects operations for a branch outside the caller\'s scope, and unsupported entities', async () => {
      const wrong = await batch([{ ...expenseOp(randomUUID()), payload: { locationId: otherLoc, businessDate: today, categoryId, amount: '5', paymentMode: 'CASH' } }]);
      expect(wrong.status).toBe(200);
      expect(wrong.body.data.results[0].result).toBe('REJECTED');
      expect(wrong.body.data.results[0].error.code).toBe('FORBIDDEN_LOCATION');

      const unknown = await batch([{ clientUuid: randomUUID(), entityType: 'STOCK_COUNT', op: 'CREATE', payload: { locationId: ownLoc } }]);
      expect(unknown.body.data.results[0].result).toBe('REJECTED');
    });

    it('bootstrap returns the master data the PWA caches for offline entry', async () => {
      const res = await http().get(`/api/v1/sync/bootstrap?locationId=${ownLoc}`).set(as(manager));
      expect(res.status).toBe(200);
      expect(res.body.data.categories.length).toBeGreaterThan(10);
      // Tamil display names travel with the masters so the phone can translate offline
      const milk = res.body.data.categories.find((c: { nameEn: string }) => c.nameEn === 'Milk');
      expect(milk.nameTa).toBe('பால்');
      expect(res.body.data.rules.receiptAbove).toBe(500);
      expect(res.body.data.bootstrapVersion).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------------------------------ owner dashboard
  describe('owner dashboard', () => {
    it('summarises the day per branch with money as strings', async () => {
      const res = await http().get(`/api/v1/dashboard/summary?date=${today}`).set(as(owner));
      expect(res.status).toBe(200);
      const row = res.body.data.branches.find((b: { locationId: string }) => b.locationId === ownLoc);
      expect(row.sales).toBe('31000');
      expect(row.closingStatus).toBe('APPROVED');
      expect(typeof res.body.data.tiles.totalSales).toBe('string');
    });

    it('managers see their own branch only', async () => {
      const res = await http().get(`/api/v1/dashboard/summary?date=${today}`).set(as(manager));
      expect(res.status).toBe(200);
      expect(res.body.data.branches.map((b: { locationId: string }) => b.locationId)).toEqual([ownLoc]);
    });
  });

  // ------------------------------------------------------------------ dashboard charts (LLD s17 band 4)
  describe('dashboard charts', () => {
    const chart = (code: string, token = owner, qs = `from=${yesterday}&to=${today}`) =>
      http().get(`/api/v1/dashboard/charts/${code}?${qs}`).set(as(token));

    it('daily sales trend: one point per day, per branch and total, null for days without data', async () => {
      const res = await chart('daily-sales-trend');
      expect(res.status).toBe(200);
      expect(res.body.data.dates).toEqual([yesterday, today]);
      expect(res.body.data.byBranch[ownLoc]).toEqual(['20000', '31000']);
      expect(Number(res.body.data.total[1])).toBeGreaterThanOrEqual(31000);
      // a branch with no sales in range is a run of nulls (a gap), never zeros
      const other = res.body.data.byBranch[otherLoc];
      expect(other.every((v: unknown) => v === null || typeof v === 'string')).toBe(true);
    });

    it('branch-wise sales adds the range and ranks branches', async () => {
      const res = await chart('branch-sales');
      const row = res.body.data.rows.find((r: { locationId: string }) => r.locationId === ownLoc);
      expect(row.sales).toBe('51000');
      expect(row.days).toBe(2);
      const sales = res.body.data.rows.map((r: { sales: string }) => Number(r.sales));
      expect(sales).toEqual([...sales].sort((a, b) => b - a));
    });

    it('expense category breakdown totals the approved and pending expenses of the range', async () => {
      const res = await chart('expense-categories');
      expect(Number(res.body.data.total)).toBeGreaterThan(0);
      const sum = res.body.data.rows.reduce((a: number, r: { amount: string }) => a + Number(r.amount), 0);
      expect(sum).toBeCloseTo(Number(res.body.data.total), 2);
    });

    it('monthly sales and expenses always return 12 calendar months ending this month', async () => {
      for (const code of ['monthly-sales', 'monthly-expenses']) {
        const res = await chart(code, owner, 'from=2020-01-01&to=2020-01-02'); // range is ignored for monthly charts
        expect(res.body.data.months).toHaveLength(12);
        expect(res.body.data.months[11].month).toBe(today.slice(0, 7));
      }
      const sales = await chart('monthly-sales');
      expect(Number(sales.body.data.months[11].amount)).toBeGreaterThanOrEqual(51000);
    });

    it('branch profitability = (sales - operating expenses - wastage) / sales', async () => {
      const res = await chart('branch-profitability');
      const row = res.body.data.rows.find((r: { locationId: string }) => r.locationId === ownLoc);
      const profit = Number(row.sales) - Number(row.expenses) - Number(row.wastage);
      expect(Number(row.profit)).toBeCloseTo(profit, 2);
      expect(Number(row.marginPct)).toBeCloseTo((profit / Number(row.sales)) * 100, 1);
      // a branch with no sales has no margin (null), not 0% or a divide-by-zero
      const idle = res.body.data.rows.find((r: { sales: string }) => Number(r.sales) === 0);
      if (idle) expect(idle.marginPct).toBeNull();
    });

    it('stock consumption and wastage trend return their series shape', async () => {
      const stock = await chart('stock-consumption');
      expect(stock.status).toBe(200);
      expect(Array.isArray(stock.body.data.items)).toBe(true);
      const wastage = await chart('wastage-trend');
      expect(wastage.body.data.dates).toEqual([yesterday, today]);
      expect(wastage.body.data.value).toHaveLength(2);
      expect(wastage.body.data.pctOfSales).toHaveLength(2);
    });

    it('a manager only ever sees their own branch in every chart', async () => {
      const bs = await chart('branch-sales', manager);
      expect(bs.body.data.rows.map((r: { locationId: string }) => r.locationId)).toEqual([ownLoc]);
      const trend = await chart('daily-sales-trend', manager);
      expect(Object.keys(trend.body.data.byBranch)).toEqual([ownLoc]);
      const prof = await chart('branch-profitability', manager);
      expect(prof.body.data.rows.map((r: { locationId: string }) => r.locationId)).toEqual([ownLoc]);
    });

    it('rejects unknown charts, backwards ranges and ranges over 400 days', async () => {
      expect((await chart('nope')).status).toBe(404);
      const back = await chart('branch-sales', owner, `from=${today}&to=${yesterday}`);
      expect(back.status).toBe(422);
      expect(back.body.error.code).toBe('INVALID_RANGE');
      const long = await chart('branch-sales', owner, `from=2024-01-01&to=${today}`);
      expect(long.status).toBe(422);
    });
  });

  // ------------------------------------------------------------------ daily cash reconciliation (critical module)
  describe('cash reconciliation', () => {
    let br: string; // a fresh branch + its manager, so the numbers below are exact
    let mgr: string;
    let otherMgr: string;
    let reconId: string;
    let withdrawalId: string;
    let receiptId: string;
    const put = (body: object, token = mgr) =>
      http().put(`/api/v1/cash/reconciliation/${br}/${today}`).set(as(token)).send(body);
    const get = async (token = mgr) => (await http().get(`/api/v1/cash/reconciliation/${br}/${today}`).set(as(token))).body.data;
    const photo = async (token: string, locationId: string) => {
      const p = await http().post('/api/v1/attachments/presign').set(as(token)).send({ fileName: 'note.png', mimeType: 'image/png', sizeBytes: PNG.length, locationId });
      await http().put(p.body.data.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
      return p.body.data.key as string;
    };

    beforeAll(async () => {
      const loc = await http().post('/api/v1/locations').set(as(owner)).send({ code: `CR${rnd}`, name: `Cash Branch ${rnd}`, type: 'BRANCH', defaultOpeningCash: '2000.00' });
      br = loc.body.data.id;
      const u = await http().post('/api/v1/users').set(as(owner)).send({ username: `crm${rnd}`, password: 'Test@12345', fullName: 'Cash Manager', roleCodes: ['BRANCH_MANAGER'], locationIds: [br] });
      expect(u.status).toBe(201);
      mgr = (await login(`crm${rnd}`, 'Test@12345')).body.data.accessToken;
      // a second branch's manager, to prove branches cannot touch each other's cash
      otherMgr = manager;
    });

    it('SRS example: opening 2,000 + cash sales 10,000 - cash expenses 1,500 = expected 10,500; counted 10,200 = shortage 300', async () => {
      await http().put(`/api/v1/daily-sales?locationId=${br}&date=${today}`).set(as(mgr)).send({ totalSales: '10000.00', cashSales: '10000.00' }).expect(200);
      const cat = (await http().get('/api/v1/expense-categories').set(as(mgr))).body.data[0].id;
      const key = await photo(mgr, br);
      const exp = await http().post('/api/v1/expenses').set(as(mgr)).send({ locationId: br, businessDate: today, categoryId: cat, amount: '1500.00', paymentMode: 'CASH', attachmentKeys: [key] });
      expect(exp.status).toBe(201);

      const before = await get();
      expect(before.openingCash).toBe('2000');
      expect(before.cashSales).toBe('10000');
      expect(before.cashExpenses).toBe('1500');
      expect(before.expectedClosing).toBe('10500');

      const saved = await put({ actualClosing: '10200.00' });
      expect(saved.status).toBe(200);
      expect(saved.body.data.variance).toBe('-300');
      expect(saved.body.data.varianceLabel).toBe('SHORTAGE');
      reconId = saved.body.data.id;

      // a surplus reads as a surplus
      const surplus = await put({ actualClosing: '10650.00' });
      expect(surplus.body.data.variance).toBe('150');
      expect(surplus.body.data.varianceLabel).toBe('SURPLUS');
      await put({ actualClosing: '10500.00' }).then((r) => expect(r.body.data.varianceLabel).toBe('TALLIED'));
      await put({ actualClosing: '10200.00' });
    });

    it('other cash receipts and withdrawals move expected cash, and a saved count follows them', async () => {
      const post = (type: string, amount: string) =>
        http().post('/api/v1/cash/transactions').set(as(mgr)).send({ locationId: br, businessDate: today, type, amount, description: 'test' });
      const r = await post('OTHER_RECEIPT', '500.00');
      expect(r.status).toBe(201);
      receiptId = r.body.data.id;
      const w = await post('WITHDRAWAL', '200.00');
      withdrawalId = w.body.data.id;

      // 10,500 + 500 receipt - 200 withdrawal = 10,800 expected; the saved count of 10,200 is now 600 short
      const view = await get();
      expect(view.otherReceipts).toBe('500');
      expect(view.withdrawals).toBe('200');
      expect(view.expectedClosing).toBe('10800');
      expect(view.variance).toBe('-600');

      // cancelling a hand-entered movement is allowed (never a delete); an expense's cash line is not cancellable here
      const cancel = await http().post(`/api/v1/cash/transactions/${withdrawalId}/cancel`).set(as(mgr)).send({});
      expect(cancel.status).toBe(200);
      expect(cancel.body.data.status).toBe('CANCELLED');
      expect((await get()).expectedClosing).toBe('11000');
      const list = (await http().get(`/api/v1/cash/transactions?locationId=${br}&date=${today}`).set(as(mgr))).body.data;
      const expenseLine = list.find((t: { txnType: string }) => t.txnType === 'EXPENSE');
      const refuse = await http().post(`/api/v1/cash/transactions/${expenseLine.id}/cancel`).set(as(mgr)).send({});
      expect(refuse.status).toBe(409);

      await http().post(`/api/v1/cash/transactions/${receiptId}/cancel`).set(as(mgr)).send({}).expect(200);
      const back = await get();
      expect(back.expectedClosing).toBe('10500');
      expect(back.variance).toBe('-300');
    });

    it('a variance is a DRAFT until sent; sending needs a reason and an explanation; a photo is optional', async () => {
      expect((await get()).varianceApproval).toBe('DRAFT');

      const noReason = await http().post(`/api/v1/cash/reconciliation/${br}/${today}/submit`).set(as(mgr)).send({});
      expect(noReason.status).toBe(422);
      expect(noReason.body.error.code).toBe('VARIANCE_REASON_REQUIRED');

      // too-short explanation is still refused
      await put({ varianceReason: 'SHORT_CHANGE', managerExplanation: 'too short' });
      expect((await http().post(`/api/v1/cash/reconciliation/${br}/${today}/submit`).set(as(mgr)).send({})).status).toBe(422);

      const key = await photo(mgr, br);
      const withPhoto = await put({ varianceReason: 'SHORT_CHANGE', managerExplanation: 'Gave wrong change during the evening rush', attachmentKeys: [key] });
      expect(withPhoto.body.data.photos).toHaveLength(1);

      const sent = await http().post(`/api/v1/cash/reconciliation/${br}/${today}/submit`).set(as(mgr)).send({});
      expect(sent.status).toBe(200);
      expect(sent.body.data.varianceApproval).toBe('SUBMITTED');
      expect((await http().post(`/api/v1/cash/reconciliation/${br}/${today}/submit`).set(as(mgr)).send({})).status).toBe(409);

      // more than three photos is refused
      const extra = [await photo(mgr, br), await photo(mgr, br), await photo(mgr, br)];
      expect((await put({ attachmentKeys: extra })).status).toBe(422);
    });

    it('a tallied day needs no approval', async () => {
      await put({ actualClosing: '10500.00' });
      const v = await get();
      expect(v.varianceApproval).toBeNull();
      const res = await http().post(`/api/v1/cash/reconciliation/${br}/${today}/submit`).set(as(mgr)).send({});
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NO_VARIANCE');
      await put({ actualClosing: '10200.00' }); // back to the 300 shortage
      expect((await get()).varianceApproval).toBe('DRAFT'); // a re-opened variance starts again as a draft
      await http().post(`/api/v1/cash/reconciliation/${br}/${today}/submit`).set(as(mgr)).send({}).expect(200);
    });

    it('managers cannot approve or touch another branch; the owner sees every branch', async () => {
      expect((await http().post(`/api/v1/cash/reconciliation/${reconId}/approve`).set(as(mgr)).send({})).status).toBe(403);
      // another branch's manager gets a scope error on this branch
      const other = await http().get(`/api/v1/cash/reconciliation/${br}/${today}`).set(as(otherMgr));
      expect(other.status).toBe(403);
      expect((await http().post(`/api/v1/cash/reconciliation/${br}/${today}/submit`).set(as(otherMgr)).send({})).status).toBe(403);

      const ov = await http().get(`/api/v1/cash/overview?date=${today}`).set(as(owner));
      expect(ov.status).toBe(200);
      const row = ov.body.data.rows.find((r: { locationId: string }) => r.locationId === br);
      expect(row.expectedClosing).toBe('10500');
      expect(row.actualClosing).toBe('10200');
      expect(row.variance).toBe('-300');
      expect(row.varianceLabel).toBe('SHORTAGE');
      expect(row.varianceApproval).toBe('SUBMITTED');
      expect(row.photoCount).toBe(1);
      expect(ov.body.data.rows.length).toBeGreaterThan(1); // all branches
      expect(ov.body.data.totals.awaitingApproval).toBeGreaterThanOrEqual(1);

      const mine = await http().get(`/api/v1/cash/overview?date=${today}`).set(as(mgr));
      expect(mine.body.data.rows.map((r: { locationId: string }) => r.locationId)).toEqual([br]);
    });

    it('owner approval records who approved and when; changing the count later withdraws the approval', async () => {
      const ok = await http().post(`/api/v1/cash/reconciliation/${reconId}/approve`).set(as(owner)).send({});
      expect(ok.status).toBe(200);
      expect(ok.body.data.varianceApproval).toBe('APPROVED');
      const v = await get(owner);
      expect(v.varianceApproval).toBe('APPROVED');
      expect(v.approvedBy).toBe('Owner');
      expect(v.approvedAt).toBeTruthy();

      // an approval only covers the figures it approved
      await put({ actualClosing: '10300.00' });
      const changed = await get();
      expect(changed.varianceApproval).toBe('DRAFT');
      expect(changed.approvedBy).toBeNull();

      // rejection: send again, the owner rejects with a comment, the manager corrects and it is a draft again
      await put({ managerExplanation: 'Recounted the tin twice; short by 200 after the correction' });
      await http().post(`/api/v1/cash/reconciliation/${br}/${today}/submit`).set(as(mgr)).send({}).expect(200);
      const noComment = await http().post(`/api/v1/cash/reconciliation/${reconId}/reject`).set(as(owner)).send({});
      expect(noComment.status).toBe(422);
      await http().post(`/api/v1/cash/reconciliation/${reconId}/reject`).set(as(owner)).send({ comment: 'Please recount' }).expect(200);
      expect((await get()).varianceApproval).toBe('REJECTED');
      await put({ actualClosing: '10200.00' });
      expect((await get()).varianceApproval).toBe('DRAFT');
    });

    it('Cash Variance Report: reasons, explanations, approval and a per-branch summary; scoped for managers', async () => {
      await http().post(`/api/v1/cash/reconciliation/${br}/${today}/submit`).set(as(mgr)).send({}).expect(200);
      await http().post(`/api/v1/cash/reconciliation/${reconId}/approve`).set(as(owner)).send({}).expect(200);

      const rep = await http().get(`/api/v1/cash/variance-report?from=${today}&to=${today}`).set(as(owner));
      expect(rep.status).toBe(200);
      const row = rep.body.data.rows.find((r: { locationId: string }) => r.locationId === br);
      expect(row.variance).toBe('-300');
      expect(row.varianceLabel).toBe('SHORTAGE');
      expect(row.reason).toBe('SHORT_CHANGE');
      expect(row.managerExplanation).toContain('Recounted');
      expect(row.approvalStatus).toBe('APPROVED');
      expect(row.approvedBy).toBe('Owner');
      expect(row.photoCount).toBe(1);
      expect(rep.body.data.summary.shortageCount).toBeGreaterThanOrEqual(1);
      expect(Number(rep.body.data.summary.net)).toBeLessThanOrEqual(-300);

      const branchRow = rep.body.data.byBranch.find((b: { locationId: string }) => b.locationId === br);
      expect(branchRow.daysReconciled).toBe(1);
      expect(branchRow.cashSales).toBe('10000');
      expect(branchRow.netVariance).toBe('-300');
      expect(branchRow.shortageDays).toBe(1);
      expect(branchRow.largestShortage).toBe('-300');

      // filters
      const surplus = await http().get(`/api/v1/cash/variance-report?from=${today}&to=${today}&type=surplus&locationId=${br}`).set(as(owner));
      expect(surplus.body.data.rows).toEqual([]);
      const submitted = await http().get(`/api/v1/cash/variance-report?from=${today}&to=${today}&status=SUBMITTED&locationId=${br}`).set(as(owner));
      expect(submitted.body.data.rows).toEqual([]);
      const approved = await http().get(`/api/v1/cash/variance-report?from=${today}&to=${today}&status=APPROVED&locationId=${br}`).set(as(owner));
      expect(approved.body.data.rows).toHaveLength(1);

      // a manager reads only their own branch
      const own = await http().get(`/api/v1/cash/variance-report?from=${today}&to=${today}`).set(as(mgr));
      expect(own.body.data.rows.every((r: { locationId: string }) => r.locationId === br)).toBe(true);
      expect((await http().get(`/api/v1/cash/variance-report?locationId=${otherLoc}`).set(as(mgr))).status).toBe(403);
      expect((await http().get(`/api/v1/cash/variance-report?from=${today}&to=2020-01-01`).set(as(owner))).status).toBe(422);
    });

    it('submitting the daily closing sends an unsent variance for approval', async () => {
      // move the count so the variance is a fresh draft, then submit the closing
      await put({ actualClosing: '10250.00', varianceReason: 'COUNTING_ERROR', managerExplanation: 'Miscounted the coins at close' });
      expect((await get()).varianceApproval).toBe('DRAFT');
      const closing = (await http().get(`/api/v1/closings/${br}/${today}`).set(as(mgr))).body.data.closing.id;
      const res = await http().post(`/api/v1/closings/${closing}/submit`).set(as(mgr)).send({});
      expect(res.status).toBe(200);
      expect((await get()).varianceApproval).toBe('SUBMITTED');
    });
  });

  // ------------------------------------------------------------------ branch management (owner menu)
  describe('branch management', () => {
    let branchA: string;
    let branchB: string;
    let m1: string; // manager user ids
    let m2: string;
    const codeA = `XA${rnd}`;
    const codeB = `XB${rnd}`;
    const post = (path: string, body: object, token = owner) => http().post(`/api/v1${path}`).set(as(token)).send(body);
    const users = async () => (await http().get('/api/v1/users').set(as(owner))).body.data as Array<{ id: string; locationIds: string[] }>;
    const branch = async (id: string) => (await http().get(`/api/v1/locations/${id}`).set(as(owner))).body.data;

    it('branch IDs are unique, upper-case and configurable: the next code follows the prefix setting', async () => {
      const next = await http().get('/api/v1/locations/next-code?type=BRANCH').set(as(owner));
      expect(next.status).toBe(200);
      expect(next.body.data.code).toBe('BR007'); // BR001-BR006 exist in the seed; the number is derived from data

      // the prefix is a setting, not a constant
      await http().put('/api/v1/settings/branch.code_prefix').set(as(owner)).send({ value: 'ZZ' }).expect(200);
      try {
        const changed = await http().get('/api/v1/locations/next-code?type=BRANCH').set(as(owner));
        expect(changed.body.data.code).toBe('ZZ001');
      } finally {
        await http().put('/api/v1/settings/branch.code_prefix').set(as(owner)).send({ value: 'BR' }).expect(200);
      }
      expect((await http().put('/api/v1/settings/branch.code_prefix').set(as(owner)).send({ value: 'bad prefix!' })).status).toBe(422);
    });

    it('suggests the Tamil form of a name; falls back offline; never needs the internet to save a branch', async () => {
      const tamil = /[஀-௿]/;
      const ext = await http().get('/api/v1/locations/transliterate?text=Guindy').set(as(owner));
      expect(ext.status).toBe(200);
      expect(ext.body.data.tamil).toMatch(tamil);
      expect(['google', 'local']).toContain(ext.body.data.source); // depends on whether this machine is online

      // switch the external service off: the built-in fallback answers, deterministically
      await http().put('/api/v1/settings/transliteration.external').set(as(owner)).send({ value: false }).expect(200);
      try {
        const local = await http().get('/api/v1/locations/transliterate?text=Anna%20Nagar').set(as(owner));
        expect(local.body.data).toEqual({ tamil: 'அன்ன நகர்', source: 'local' });

        // a branch created without a Tamil name gets one automatically
        const auto = await post('/locations', { code: `XT${rnd}`, name: 'Guindy', type: 'BRANCH' });
        expect(auto.status).toBe(201);
        expect(auto.body.data.nameTa).toBe('கின்டி');
        // an explicit Tamil name is never overwritten
        const own = await post('/locations', { code: `XU${rnd}`, name: 'Guindy', nameTa: 'கிண்டி', type: 'BRANCH' });
        expect(own.body.data.nameTa).toBe('கிண்டி');
      } finally {
        await http().put('/api/v1/settings/transliteration.external').set(as(owner)).send({ value: true }).expect(200);
      }

      expect((await http().get('/api/v1/locations/transliterate?text=').set(as(owner))).body.data.tamil).toBe('');
      expect((await http().get('/api/v1/locations/transliterate?text=Guindy').set(as(manager))).status).toBe(403);
    });

    it('rejects lower-case codes and duplicates; managers cannot add branches', async () => {
      const lower = await post('/locations', { code: 'br900', name: 'Nope', type: 'BRANCH' });
      expect(lower.status).toBe(422);
      expect(lower.body.error.code).toBe('VALIDATION_ERROR');

      const a = await post('/locations', { code: codeA, name: `Branch A ${rnd}`, nameTa: 'கிளை அ', type: 'BRANCH', defaultOpeningCash: '1500.00', monthlyRent: '25000.00' });
      expect(a.status).toBe(201);
      branchA = a.body.data.id;
      const b = await post('/locations', { code: codeB, name: `Branch B ${rnd}`, type: 'BRANCH' });
      branchB = b.body.data.id;

      const dup = await post('/locations', { code: codeA, name: 'Same code', type: 'BRANCH' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('DUPLICATE');

      expect((await post('/locations', { code: 'ZZ999', name: 'x', type: 'BRANCH' }, manager)).status).toBe(403);
      expect((await http().get('/api/v1/locations/next-code').set(as(manager))).status).toBe(403);
    });

    it('the code is fixed once created; name, opening cash, rent and card setting can be edited', async () => {
      const res = await http().patch(`/api/v1/locations/${branchA}`).set(as(owner)).send({
        code: 'HACK1', name: `Branch A renamed ${rnd}`, defaultOpeningCash: '3000.00', cardEnabled: false, monthlyRent: '27000.00',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.code).toBe(codeA); // the code field is ignored
      expect(res.body.data.name).toContain('renamed');
      expect(res.body.data.defaultOpeningCash).toBe('3000');
      expect(res.body.data.cardEnabled).toBe(false);
      expect(res.body.data.monthlyRent).toBe('27000');
    });

    it('assigns a manager, moves them between branches, and takes access away from the previous manager', async () => {
      for (const [name, loc] of [['m1', branchA], ['m2', branchB]] as const) {
        const u = await post('/users', { username: `${name}${rnd}`, password: 'Test@12345', fullName: `Manager ${name}`, roleCodes: ['BRANCH_MANAGER'], locationIds: [loc] });
        expect(u.status).toBe(201);
        if (name === 'm1') m1 = u.body.data.id; else m2 = u.body.data.id;
      }

      const first = await post(`/locations/${branchA}/manager`, { userId: m1 });
      expect(first.status).toBe(200);
      expect(first.body.data.manager.id).toBe(m1);
      expect(first.body.data.manager.fullName).toBe('Manager m1');

      // moving m1 to branch B: B gets them, A loses its manager, m1 works at exactly one branch
      const moved = await post(`/locations/${branchB}/manager`, { userId: m1 });
      expect(moved.body.data.manager.id).toBe(m1);
      expect((await branch(branchA)).manager).toBeNull();
      expect((await users()).find((u) => u.id === m1)!.locationIds).toEqual([branchB]);

      // replacing B's manager with m2: m1 is left with no branch, m2 has B only
      await post(`/locations/${branchB}/manager`, { userId: m2 }).then((r) => expect(r.status).toBe(200));
      const all = await users();
      expect(all.find((u) => u.id === m1)!.locationIds).toEqual([]);
      expect(all.find((u) => u.id === m2)!.locationIds).toEqual([branchB]);

      // clearing
      const cleared = await post(`/locations/${branchB}/manager`, { userId: null });
      expect(cleared.body.data.manager).toBeNull();
    });

    it('only an active Branch Manager can be assigned', async () => {
      const list = (await http().get('/api/v1/users').set(as(owner))).body.data as Array<{ id: string; username: string }>;
      const accountant = list.find((u) => u.username === 'accountant')!;
      const res = await post(`/locations/${branchA}/manager`, { userId: accountant.id });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_MANAGER');
      expect((await post(`/locations/${branchA}/manager`, { userId: m1 }, manager)).status).toBe(403);
    });

    it('a deactivated branch drops out of the dashboard and can be reactivated', async () => {
      const off = await post(`/locations/${branchA}/deactivate`, {});
      expect(off.body.data.status).toBe('INACTIVE');
      const summary = await http().get(`/api/v1/dashboard/summary?date=${today}`).set(as(owner));
      expect(summary.body.data.branches.some((b: { locationId: string }) => b.locationId === branchA)).toBe(false);
      const on = await post(`/locations/${branchA}/activate`, {});
      expect(on.body.data.status).toBe('ACTIVE');
    });

    it('history lists every change to the branch, newest first, with who did it and pages with a cursor', async () => {
      const res = await http().get(`/api/v1/locations/${branchA}/history?limit=3`).set(as(owner));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.meta.hasMore).toBe(true);
      const ids = res.body.data.map((r: { id: string }) => BigInt(r.id));
      expect(ids).toEqual([...ids].sort((a, b) => (a < b ? 1 : -1))); // newest first
      expect(res.body.data[0].actorName).toBe('Owner');

      const older = await http().get(`/api/v1/locations/${branchA}/history?limit=50&before=${res.body.meta.next}`).set(as(owner));
      expect(older.body.data.every((r: { id: string }) => BigInt(r.id) < BigInt(res.body.meta.next))).toBe(true);

      const all = await http().get(`/api/v1/locations/${branchA}/history?limit=100&entityType=LOCATION`).set(as(owner));
      const updates = all.body.data.filter((r: { action: string }) => r.action === 'UPDATE');
      const edit = updates.find((r: { changedFields: string[] }) => r.changedFields.includes('default_opening_cash'));
      expect(edit.oldValues.default_opening_cash).toBe('1500');
      expect(edit.newValues.default_opening_cash).toBe('3000');
      expect(all.body.data.some((r: { action: string; reason: string }) => r.action === 'PERMISSION_CHANGE' && r.reason === 'manager assigned')).toBe(true);
    });

    it('branch report: totals reconcile with the day rows, and managers only read their own branch', async () => {
      const res = await http().get(`/api/v1/locations/${ownLoc}/report?from=${yesterday}&to=${today}`).set(as(owner));
      expect(res.status).toBe(200);
      const r = res.body.data;
      expect(r.days.map((d: { date: string }) => d.date)).toEqual([yesterday, today]);
      expect(r.summary.totalSales).toBe('51000');
      expect(r.summary.salesDays).toBe(2);
      expect(r.summary.avgDailySales).toBe('25500');

      const dayExpenses = r.days.reduce((a: number, d: { expenses: string }) => a + Number(d.expenses), 0);
      expect(dayExpenses).toBeCloseTo(Number(r.summary.totalExpenses), 2);
      const byCat = r.expenseByCategory.reduce((a: number, c: { amount: string }) => a + Number(c.amount), 0);
      expect(byCat).toBeCloseTo(Number(r.summary.totalExpenses), 2);
      expect(Number(r.summary.operatingProfit)).toBeCloseTo(
        Number(r.summary.totalSales) - Number(r.summary.operatingExpenses) - Number(r.summary.totalWastage), 2);
      expect(r.summary.closings.approved).toBeGreaterThanOrEqual(1); // today was approved earlier in this run

      const own = await http().get(`/api/v1/locations/${ownLoc}/report?from=${yesterday}&to=${today}`).set(as(manager));
      expect(own.status).toBe(200);
      const other = await http().get(`/api/v1/locations/${otherLoc}/report`).set(as(manager));
      expect(other.status).toBe(404); // not visible to them at all (row-level security)
      expect((await http().get(`/api/v1/locations/${ownLoc}/report?from=${today}&to=${yesterday}`).set(as(owner))).status).toBe(422);
    });
  });
});
