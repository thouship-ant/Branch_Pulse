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
});
