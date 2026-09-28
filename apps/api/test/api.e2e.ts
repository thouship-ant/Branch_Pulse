import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { addDaysStr, todayIST } from '../src/common/dates';
import { PrismaService } from '../src/common/prisma.service';
import { RecipesService } from '../src/recipes/recipes.service';
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
      const categoryId = (await http().get('/api/v1/expense-categories').set(as(owner))).body.data.find((c: any) => !c.parentId).id;
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
      categoryId = (await http().get('/api/v1/expense-categories').set(as(manager))).body.data.find((c: any) => !c.parentId).id;
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
      categoryId = (await http().get('/api/v1/expense-categories').set(as(manager))).body.data.find((c: any) => !c.parentId).id;
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

    it('stock value, stock variance, salary payable and supplier outstanding are real point-in-time balances, not tied to one day', async () => {
      const dloc = (await http().post('/api/v1/locations').set(as(owner)).send({ code: `DB${rnd}`, name: `Dashboard Test ${rnd}`, type: 'BRANCH', defaultOpeningCash: '500.00' })).body.data.id;
      const supplierId = (await http().post('/api/v1/suppliers').set(as(owner)).send({ name: `Dashboard Supplier ${rnd}` })).body.data.id;
      const boot = (await http().get('/api/v1/sync/bootstrap').set(as(owner))).body.data;
      const uKg = boot.units.find((u: any) => u.code === 'KG').id;
      const uG = boot.units.find((u: any) => u.code === 'G').id;
      const itemId = (await http().post('/api/v1/items').set(as(owner)).send({ nameEn: `Dashboard Item ${rnd}`, category: 'RAW_MATERIAL', baseUnitId: uG, purchaseUnitId: uKg })).body.data.id;

      // 5 kg @ 40/kg = 200 stock value, all cash (no supplier outstanding from this one)
      await http().post('/api/v1/purchases').set(as(owner)).send({
        locationId: dloc, businessDate: today, paymentMode: 'CASH', supplierId, items: [{ itemId, unitId: uKg, quantity: '5', rate: '40' }],
      }).expect(201);

      const before = (await http().get(`/api/v1/dashboard/summary?date=${today}`).set(as(owner))).body.data.tiles;

      // a credit purchase raises company-wide supplier outstanding by exactly its credit amount
      await http().post('/api/v1/purchases').set(as(owner)).send({
        locationId: dloc, businessDate: today, paymentMode: 'CREDIT', supplierId, dueDate: addDaysStr(today, 10), items: [{ itemId, unitId: uKg, quantity: '1', rate: '40' }],
      }).expect(201);

      // a physical count 500 g short of expected (2 kg @ 40/kg -> -20); the dashboard tile only needs it saved, not submitted
      await http().put(`/api/v1/stock/counts/${dloc}/${today}`).set(as(owner)).send({ items: [{ itemId, physicalQty: '5500' }] }).expect(200);

      // an unpaid, un-approved payroll run still counts as owed
      const empId = (await http().post('/api/v1/employees').set(as(owner)).send({
        fullName: `Dashboard Employee ${rnd}`, locationId: dloc, jobRole: 'Staff', joiningDate: addDaysStr(today, -10), salaryType: 'DAILY', baseSalary: '300',
      })).body.data.id;
      await http().put('/api/v1/attendance').set(as(owner)).send({ locationId: dloc, businessDate: today, items: [{ employeeId: empId, status: 'PRESENT' }] }).expect(200);
      await http().post('/api/v1/salary/compute').set(as(owner)).send({ employeeId: empId, month: today.slice(0, 7) }).expect(201);

      const after = (await http().get(`/api/v1/dashboard/summary?date=${today}&locationIds=${dloc}`).set(as(owner))).body.data.tiles;
      expect(after.totalStockValue).toBe('240'); // 5kg + 1kg @ 40/kg, minus nothing sold or wasted; the unapproved count above hasn't touched the books yet
      expect(after.stockVariance).toBe('-20'); // 500g short @ 40/kg
      expect(after.salaryPayable).toBe('300'); // 1 present day, unpaid

      const afterAll = (await http().get(`/api/v1/dashboard/summary?date=${today}`).set(as(owner))).body.data.tiles;
      expect(Number(afterAll.supplierOutstanding) - Number(before.supplierOutstanding)).toBeCloseTo(40, 2);
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
      const cat = (await http().get('/api/v1/expense-categories').set(as(mgr))).body.data.find((c: any) => !c.parentId).id;
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

  // ------------------------------------------------------------------ expense management: categories, ledger fields, owner analytics
  describe('expense management', () => {
    let br: string;
    let mgr: string;
    let cat: string;
    let sub: string;
    let sub2: string;
    let supplier: string;
    let bigId: string;
    let rejectedId: string;
    const cats = async (token: string, qs = '') => (await http().get(`/api/v1/expense-categories${qs}`).set(as(token))).body.data as any[];
    const spend = (body: object) => http().post('/api/v1/expenses').set(as(mgr)).send({ locationId: br, paymentMode: 'CASH', ...body });

    beforeAll(async () => {
      const loc = await http().post('/api/v1/locations').set(as(owner)).send({ code: `EX${rnd}`, name: `Expense Branch ${rnd}`, type: 'BRANCH', defaultOpeningCash: '1000.00' });
      br = loc.body.data.id;
      await http().post('/api/v1/users').set(as(owner)).send({ username: `exm${rnd}`, password: 'Test@12345', fullName: 'Expense Manager', roleCodes: ['BRANCH_MANAGER'], locationIds: [br] }).expect(201);
      mgr = (await login(`exm${rnd}`, 'Test@12345')).body.data.accessToken;
    });

    it('categories and sub-categories are configurable by the owner, not by a manager', async () => {
      const denied = await http().post('/api/v1/expense-categories').set(as(mgr)).send({ nameEn: `X${rnd}`, plBucket: 'OTHER' });
      expect(denied.status).toBe(403);

      const c = await http().post('/api/v1/expense-categories').set(as(owner)).send({ nameEn: `Test cat ${rnd}`, nameTa: 'சோதனை', plBucket: 'OTHER', sortOrder: 500 });
      expect(c.status).toBe(201);
      cat = c.body.data.id;
      expect(c.body.data.sortOrder).toBe(500);
      const s1 = await http().post('/api/v1/expense-categories').set(as(owner)).send({ nameEn: `Sub A ${rnd}`, plBucket: 'OTHER', parentId: cat });
      const s2 = await http().post('/api/v1/expense-categories').set(as(owner)).send({ nameEn: `Sub B ${rnd}`, plBucket: 'OTHER', parentId: cat });
      expect(s1.status).toBe(201);
      sub = s1.body.data.id;
      sub2 = s2.body.data.id;
      // a sub-category cannot have children
      expect((await http().post('/api/v1/expense-categories').set(as(owner)).send({ nameEn: `Deep ${rnd}`, plBucket: 'OTHER', parentId: sub })).status).toBe(422);

      // every default category from the brief exists
      const names = (await cats(manager)).filter((x) => !x.parentId).map((x) => x.nameEn);
      for (const n of ['Milk', 'Tea powder', 'Coffee', 'Sugar', 'Snacks / raw materials', 'Cooking oil', 'Gas', 'Electricity', 'Rent', 'Salary', 'Transport', 'Maintenance', 'Cleaning', 'Packaging', 'Repairs', 'Staff advance', 'Miscellaneous']) {
        expect(names).toContain(n);
      }
    });

    it('a per-category receipt limit can be set and cleared again; switching a category off hides it from entry but not from the owner', async () => {
      const set = await http().patch(`/api/v1/expense-categories/${cat}`).set(as(owner)).send({ requiresReceiptAbove: '100.00' });
      expect(set.body.data.requiresReceiptAbove).toBe('100');
      const cleared = await http().patch(`/api/v1/expense-categories/${cat}`).set(as(owner)).send({ requiresReceiptAbove: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.data.requiresReceiptAbove).toBeNull();

      await http().patch(`/api/v1/expense-categories/${sub2}`).set(as(owner)).send({ active: false }).expect(200);
      expect((await cats(mgr)).some((x) => x.id === sub2)).toBe(false);
      expect((await cats(mgr, '?includeInactive=true')).some((x) => x.id === sub2)).toBe(false); // managers never see inactive ones
      expect((await cats(owner, '?includeInactive=true')).some((x) => x.id === sub2)).toBe(true);
      const refused = await spend({ businessDate: today, categoryId: cat, subCategoryId: sub2, amount: '10.00' });
      expect(refused.status).toBe(422);
      await http().patch(`/api/v1/expense-categories/${sub2}`).set(as(owner)).send({ active: true }).expect(200);
    });

    it('stores every field of an expense: date, branch, category, sub-category, amount, mode, supplier/payee, description, receipt, entered/approved by', async () => {
      const boot = await http().get(`/api/v1/sync/bootstrap?locationId=${br}`).set(as(mgr));
      supplier = boot.body.data.suppliers[0].id;
      const a = await spend({ businessDate: yesterday, categoryId: cat, subCategoryId: sub, amount: '300.00', supplierId: supplier, payeeName: 'Ravi', description: 'Morning supply' });
      expect(a.status).toBe(201);
      await spend({ businessDate: today, categoryId: cat, subCategoryId: sub, amount: '200.00', paymentMode: 'UPI' }).expect(201);

      const key = (await http().post('/api/v1/attachments/presign').set(as(mgr)).send({ fileName: 'b.png', mimeType: 'image/png', sizeBytes: PNG.length, locationId: br })).body.data;
      await http().put(key.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
      const big = await spend({ businessDate: today, categoryId: cat, amount: '800.00', paymentMode: 'BANK_TRANSFER', attachmentKeys: [key.key], description: 'Repair advance' });
      expect(big.status).toBe(201);
      expect(big.body.data.approvalStatus).toBe('SUBMITTED'); // above the manager's limit
      bigId = big.body.data.id;

      const list = await http().get(`/api/v1/expenses?locationId=${br}&from=${yesterday}&to=${today}`).set(as(owner));
      expect(list.status).toBe(200);
      const rows = list.body.data as any[];
      expect(rows).toHaveLength(3);
      const first = rows.find((r) => r.amount === '300')!;
      expect(first).toMatchObject({
        categoryName: `Test cat ${rnd}`, subCategoryName: `Sub A ${rnd}`, payeeName: 'Ravi', description: 'Morning supply', paymentMode: 'CASH',
        locationCode: `EX${rnd}`, enteredByName: 'Expense Manager', approvedByName: 'Expense Manager', approvalStatus: 'APPROVED', receiptCount: 0,
      });
      expect(first.supplierName).toBeTruthy();
      expect(String(first.businessDate)).toBe(yesterday);
      const bigRow = rows.find((r) => r.id === bigId)!;
      expect(bigRow).toMatchObject({ receiptCount: 1, approvedByName: null, approvalStatus: 'SUBMITTED', paymentMode: 'BANK_TRANSFER' });
      // nothing is excluded yet: all three are approved or waiting
      expect(list.body.meta.totalAmount).toBe('1300');
    });

    it('filters the ledger by sub-category, payment mode and a search text', async () => {
      const get = async (qs: string) => (await http().get(`/api/v1/expenses?locationId=${br}&from=${yesterday}&to=${today}&${qs}`).set(as(owner))).body;
      expect((await get(`subCategoryId=${sub}`)).data).toHaveLength(2);
      expect((await get('paymentMode=UPI')).data).toHaveLength(1);
      expect((await get('q=repair')).data).toHaveLength(1);
      expect((await get('q=ravi')).data).toHaveLength(1);
      expect((await get('status=SUBMITTED')).data).toHaveLength(1);
      expect((await get('q=nothing-like-this')).data).toHaveLength(0);
    });

    it('summary: daily, weekly and monthly buckets, branch-wise, category-wise (with sub-categories), payment modes and trend', async () => {
      const day = await http().get(`/api/v1/expenses/summary?locationId=${br}&from=${yesterday}&to=${today}&groupBy=day`).set(as(owner));
      expect(day.status).toBe(200);
      const d = day.body.data;
      expect(d.days).toBe(2);
      expect(d.totals.total).toBe('1300');
      expect(d.totals.count).toBe(3);
      expect(d.totals.averagePerDay).toBe('650');
      expect(d.totals.pendingApproval).toMatchObject({ amount: '800', count: 1 });
      expect(d.totals.changePct).toBeNull(); // nothing in the previous period
      expect(d.buckets.map((b: any) => [b.start, b.amount])).toEqual([[yesterday, '300'], [today, '1000']]);
      expect(d.branches).toHaveLength(1);
      expect(d.branches[0]).toMatchObject({ code: `EX${rnd}`, amount: '1300', count: 3, sharePct: 100 });
      expect(d.categories[0]).toMatchObject({ name: `Test cat ${rnd}`, amount: '1300' });
      const subs = d.categories[0].subs;
      expect(subs.find((x: any) => x.name === `Sub A ${rnd}`)).toMatchObject({ amount: '500', count: 2 });
      expect(subs.find((x: any) => x.name === null)).toMatchObject({ amount: '800' }); // no sub-category chosen
      expect(d.paymentModes.map((m: any) => m.mode).sort()).toEqual(['BANK_TRANSFER', 'CASH', 'UPI']);
      expect(d.categoryTrend.series[0].values.map(String)).toEqual(['300', '1000']);

      for (const groupBy of ['week', 'month']) {
        const r = (await http().get(`/api/v1/expenses/summary?locationId=${br}&from=${yesterday}&to=${today}&groupBy=${groupBy}`).set(as(owner))).body.data;
        const total = r.buckets.reduce((s: number, b: any) => s + Number(b.amount), 0);
        expect(total).toBe(1300);
        if (groupBy === 'week') r.buckets.forEach((b: any) => expect(new Date(`${b.start}T00:00:00Z`).getUTCDay()).toBe(1)); // weeks start on Monday
        if (groupBy === 'month') r.buckets.forEach((b: any) => expect(b.start).toMatch(/-01$/));
      }
      // a longer range with no groupBy picks a sensible one and fills quiet days with zero
      const auto = (await http().get(`/api/v1/expenses/summary?locationId=${br}&from=${addDaysStr(today, -9)}&to=${today}`).set(as(owner))).body.data;
      expect(auto.groupBy).toBe('day');
      expect(auto.buckets).toHaveLength(10);
    });

    it('summary compares with the previous period and filters by category', async () => {
      const cmp = (await http().get(`/api/v1/expenses/summary?locationId=${br}&from=${today}&to=${today}`).set(as(owner))).body.data;
      // today 1000 vs yesterday 300 -> +233.3%
      expect(cmp.totals.previousTotal).toBe('300');
      expect(cmp.totals.changePct).toBeCloseTo(233.3, 1);
      const none = (await http().get(`/api/v1/expenses/summary?locationId=${br}&from=${yesterday}&to=${today}&categoryId=${randomUUID()}`).set(as(owner))).body.data;
      expect(none.totals.total).toBe('0');
      expect(none.categories).toHaveLength(0);
    });

    it('approving records who approved; rejected expenses drop out of the totals', async () => {
      const ok = await http().post(`/api/v1/expenses/${bigId}/approve`).set(as(owner));
      expect(ok.status).toBe(200);
      const row = (await http().get(`/api/v1/expenses?locationId=${br}&q=Repair`).set(as(owner))).body.data[0];
      expect(row).toMatchObject({ approvalStatus: 'APPROVED', approvedByName: 'Owner' });

      const k2 = (await http().post('/api/v1/attachments/presign').set(as(mgr)).send({ fileName: 'c.png', mimeType: 'image/png', sizeBytes: PNG.length, locationId: br })).body.data;
      await http().put(k2.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
      const extra = await spend({ businessDate: today, categoryId: cat, amount: '900.00', attachmentKeys: [k2.key], description: 'Wrong entry' }); // over the limit: waits for approval
      expect(extra.body.data.approvalStatus).toBe('SUBMITTED');
      rejectedId = extra.body.data.id;
      await http().post(`/api/v1/expenses/${rejectedId}/reject`).set(as(owner)).send({ reason: 'Duplicate' }).expect(200);
      const r = (await http().get(`/api/v1/expenses/summary?locationId=${br}&from=${yesterday}&to=${today}`).set(as(owner))).body.data;
      expect(r.totals.total).toBe('1300'); // unchanged
      expect(r.totals.pendingApproval.count).toBe(0);
      const rej = (await http().get(`/api/v1/expenses?locationId=${br}&status=REJECTED`).set(as(owner))).body.data[0];
      expect(rej).toMatchObject({ rejectionReason: 'Duplicate', approvalStatus: 'REJECTED' });
    });

    it('a manager sees only their own branch in the summary; a bad range is refused', async () => {
      const own = (await http().get(`/api/v1/expenses/summary?from=${yesterday}&to=${today}`).set(as(mgr))).body.data;
      expect(own.branches).toHaveLength(1);
      expect(own.branches[0].code).toBe(`EX${rnd}`);
      const other = await http().get(`/api/v1/expenses/summary?locationId=${otherLoc}&from=${yesterday}&to=${today}`).set(as(mgr));
      expect(other.status).toBe(403);
      expect((await http().get(`/api/v1/expenses/summary?from=${today}&to=${yesterday}`).set(as(owner))).status).toBe(422);
      expect((await http().get(`/api/v1/expenses/summary?from=2020-01-01&to=${today}`).set(as(owner))).status).toBe(422);
    });
  });

  // ------------------------------------------------------------------ purchase management: suppliers, cash / credit / part payment, approval -> inventory
  describe('purchase management', () => {
    let br: string;
    let mgr: string;
    let stockMgr: string;
    let godown: string;
    let supplier: string;
    let noTermsSupplier: string;
    let milk: string; // item ids and unit ids
    let sugar: string;
    let unitL: string;
    let unitKg: string;
    let cashPurchase: string;
    let creditPurchase: string;
    let partPurchase: string;
    const line = (itemId: string, unitId: string, quantity: string, rate: string) => ({ itemId, unitId, quantity, rate });
    const buy = (token: string, body: object) => http().post('/api/v1/purchases').set(as(token)).send({ businessDate: today, ...body });
    const stockOf = async (loc: string, item: string, token = owner) => {
      const rows = (await http().get(`/api/v1/stock?locationId=${loc}`).set(as(token))).body.data as any[];
      return rows.find((r) => r.itemId === item);
    };
    const outstanding = async (id = supplier) => {
      const rows = (await http().get('/api/v1/suppliers').set(as(owner))).body.data as any[];
      return rows.find((s) => s.id === id).outstanding as string;
    };

    beforeAll(async () => {
      const loc = await http().post('/api/v1/locations').set(as(owner)).send({ code: `PU${rnd}`, name: `Purchase Branch ${rnd}`, type: 'BRANCH', defaultOpeningCash: '5000.00' });
      br = loc.body.data.id;
      await http().post('/api/v1/users').set(as(owner)).send({ username: `pum${rnd}`, password: 'Test@12345', fullName: 'Purchase Manager', roleCodes: ['BRANCH_MANAGER'], locationIds: [br] }).expect(201);
      mgr = (await login(`pum${rnd}`, 'Test@12345')).body.data.accessToken;
      stockMgr = (await login('stockmgr')).body.data.accessToken;
      const boot = (await http().get('/api/v1/sync/bootstrap').set(as(owner))).body.data;
      milk = boot.items.find((i: any) => i.code === 'ITM001').id;
      sugar = boot.items.find((i: any) => i.code === 'ITM004').id;
      unitL = boot.units.find((u: any) => u.code === 'L').id;
      unitKg = boot.units.find((u: any) => u.code === 'KG').id;
      godown = (await http().get('/api/v1/locations').set(as(owner))).body.data.find((l: any) => l.code === 'GDN01').id;
    });

    it('suppliers: the owner manages them, an opening balance is owed from day one, managers cannot see balances', async () => {
      expect((await http().post('/api/v1/suppliers').set(as(mgr)).send({ name: `S${rnd}` })).status).toBe(403);
      const s = await http().post('/api/v1/suppliers').set(as(owner)).send({ name: `Dairy Farm ${rnd}`, phone: '9876543210', paymentTermsDays: 7, openingBalance: '500.00' });
      expect(s.status).toBe(201);
      expect(s.body.data.code).toMatch(/^SUP\d{4}$/);
      supplier = s.body.data.id;
      const n = await http().post('/api/v1/suppliers').set(as(owner)).send({ name: `Spot Vendor ${rnd}` }); // no credit terms
      noTermsSupplier = n.body.data.id;
      expect((await http().post('/api/v1/suppliers').set(as(owner)).send({ name: `dairy farm ${rnd}` })).status).toBe(409); // same name

      expect(await outstanding()).toBe('500');
      const seenByManager = (await http().get('/api/v1/suppliers').set(as(mgr))).body.data.find((x: any) => x.id === supplier);
      expect(seenByManager.name).toContain('Dairy Farm');
      expect(seenByManager.outstanding).toBeNull();
    });

    it('cash purchase: the till pays at once, stock and the supplier ledger move only when it is approved', async () => {
      const res = await buy(mgr, { locationId: br, supplierId: supplier, paymentMode: 'CASH', supplierRefNo: `INV-${rnd}`, items: [line(milk, unitL, '10', '60')], remarks: 'Morning delivery' });
      expect(res.status).toBe(201);
      const p = res.body.data;
      cashPurchase = p.id;
      expect(p).toMatchObject({ approvalStatus: 'SUBMITTED', totalAmount: '600', paidAmount: '600', creditAmount: '0', paymentMode: 'CASH' });
      expect(p.code).toMatch(/^PUR-PU\d+-\d\d-\d{6}$/);
      expect(res.body.warnings.map((w: any) => w.code)).toContain('NO_INVOICE');

      // cash left the till already; nothing reached stock or the supplier
      const cash = (await http().get(`/api/v1/cash/reconciliation/${br}/${today}`).set(as(mgr))).body.data;
      expect(cash.cashPurchases).toBe('600');
      expect(cash.expectedClosing).toBe('4400'); // 5,000 opening - 600
      expect((await stockOf(br, milk)).quantity).toBe('0');
      expect(await outstanding()).toBe('500');

      // a manager cannot approve their own purchase; the owner approves and stock follows
      expect((await http().post(`/api/v1/purchases/${cashPurchase}/approve`).set(as(mgr))).status).toBe(403);
      const ok = await http().post(`/api/v1/purchases/${cashPurchase}/approve`).set(as(owner));
      expect(ok.status).toBe(200);
      expect(ok.body.data.approvalStatus).toBe('APPROVED');
      const m = await stockOf(br, milk);
      expect(m.quantity).toBe('10000'); // 10 L in the item's own unit (ml)
      expect(m.avgCost).toBe('0.06');
      expect(m.value).toBe('600');
      expect(await outstanding()).toBe('500'); // bought and paid in cash: nothing new owed
    });

    it('credit purchase: goes on the supplier account, due date from the supplier terms; stock is costed by weighted average', async () => {
      const res = await buy(owner, { locationId: br, supplierId: supplier, paymentMode: 'CREDIT', items: [line(milk, unitL, '20', '62')] });
      expect(res.status).toBe(201);
      creditPurchase = res.body.data.id;
      expect(res.body.data).toMatchObject({ approvalStatus: 'APPROVED', totalAmount: '1240', paidAmount: '0', creditAmount: '1240' }); // owner: no limit
      expect(String(res.body.data.dueDate)).toBe(addDaysStr(today, 7)); // terms of 7 days
      const m = await stockOf(br, milk);
      expect(m.quantity).toBe('30000');
      expect(m.value).toBe('1840');
      expect(m.avgCost).toBe('0.0613');
      expect(await outstanding()).toBe('1740'); // 500 opening + 1,240
      // an explicit due date wins
      const later = await buy(owner, { locationId: br, supplierId: supplier, paymentMode: 'CREDIT', dueDate: addDaysStr(today, 30), items: [line(sugar, unitKg, '2', '45')] });
      expect(String(later.body.data.dueDate)).toBe(addDaysStr(today, 30));
      expect((await stockOf(br, sugar)).quantity).toBe('2000');
    });

    it('part payment: paid now + credit = total; other charges and discount are spread into the stock cost', async () => {
      const res = await buy(owner, {
        locationId: br, supplierId: supplier, paymentMode: 'UPI', paidAmount: '400.00', dueDate: addDaysStr(today, 10),
        otherCharges: '50.00', discount: '20.00', items: [line(milk, unitL, '10', '60')],
      });
      expect(res.status).toBe(201);
      partPurchase = res.body.data.id;
      expect(res.body.data).toMatchObject({ subtotal: '600', otherCharges: '50', discount: '20', totalAmount: '630', paidAmount: '400', creditAmount: '230' });
      const inv = (await http().get(`/api/v1/stock/movements?locationId=${br}&itemId=${milk}`).set(as(owner))).body.data as any[];
      const last = inv.find((r) => r.sourceCode === res.body.data.code);
      expect(last).toMatchObject({ txnType: 'PURCHASE_IN', quantity: '10000', value: '630', unitCost: '0.063' }); // landed cost
      expect(await outstanding()).toBe('2060'); // 1,830 + only the 230 left on credit
    });

    it('rejects impossible payments and bad lines', async () => {
      const base = { locationId: br, supplierId: supplier, items: [line(milk, unitL, '1', '60')] };
      expect((await buy(owner, { ...base, paymentMode: 'CASH', paidAmount: '61.00' })).body.error.code).toBe('OVERPAID');
      expect((await buy(owner, { ...base, paymentMode: 'CREDIT', paidAmount: '10.00' })).body.error.code).toBe('PAID_WITH_CREDIT');
      expect((await buy(owner, { ...base, supplierId: noTermsSupplier, paymentMode: 'CREDIT' })).body.error.code).toBe('DUE_DATE_REQUIRED');
      expect((await buy(owner, { ...base, paymentMode: 'CASH', items: [line(milk, unitKg, '1', '60')] })).body.error.code).toBe('INVALID_UNIT'); // kg is not a unit of milk
      expect((await buy(owner, { ...base, paymentMode: 'CASH', items: [] })).status).toBe(422);
      expect((await buy(owner, { ...base, paymentMode: 'CASH', discount: '999.00' })).body.error.code).toBe('INVALID_AMOUNT');
      const office = (await http().get('/api/v1/locations').set(as(owner))).body.data.find((l: any) => l.code === 'HO01').id;
      expect((await buy(owner, { ...base, locationId: office, paymentMode: 'CASH' })).body.error.code).toBe('INVALID_LOCATION');
      expect((await buy(mgr, { ...base, locationId: otherLoc, paymentMode: 'CASH' })).status).toBe(403); // another branch
    });

    it('paying a supplier: oldest dues first, part payments, cash leaves the till, never more than is owed', async () => {
      expect((await http().post(`/api/v1/suppliers/${supplier}/payments`).set(as(mgr)).send({ locationId: br, amount: '10.00', paymentMode: 'CASH' })).status).toBe(403);
      expect((await http().post(`/api/v1/suppliers/${supplier}/payments`).set(as(owner)).send({ locationId: br, amount: '99999.00', paymentMode: 'CASH' })).body.error.code).toBe('OVERPAYMENT');
      expect((await http().post(`/api/v1/suppliers/${supplier}/payments`).set(as(owner)).send({ locationId: br, amount: '10.00', paymentMode: 'CREDIT' })).status).toBe(422);

      // 300 in cash, no purchase named: the oldest due date is settled first (the 7-day credit; the 10-day and 30-day ones wait)
      const pay = await http().post(`/api/v1/suppliers/${supplier}/payments`).set(as(owner)).send({ locationId: br, amount: '300.00', paymentMode: 'CASH', referenceNo: 'CASH-1' });
      expect(pay.status).toBe(201);
      expect(pay.body.data.outstandingAfter).toBe('1760');
      const parts = pay.body.data.payments as any[];
      expect(parts.map((p) => [p.purchaseId, p.amount])).toEqual([[creditPurchase, '300']]);
      const c = (await http().get(`/api/v1/purchases/${creditPurchase}`).set(as(owner))).body.data;
      expect(c).toMatchObject({ paidAmount: '300', creditAmount: '940' });
      expect(c.payments).toHaveLength(1);
      expect((await http().get(`/api/v1/cash/reconciliation/${br}/${today}`).set(as(owner))).body.data.otherCashOut).toBe('300');

      // paying one purchase by name: part, then no more than is left
      expect((await http().post(`/api/v1/suppliers/${supplier}/payments`).set(as(owner)).send({ locationId: br, amount: '231.00', paymentMode: 'BANK_TRANSFER', purchaseId: partPurchase })).body.error.code).toBe('OVERPAYMENT');
      const part = await http().post(`/api/v1/suppliers/${supplier}/payments`).set(as(owner)).send({ locationId: br, amount: '100.00', paymentMode: 'BANK_TRANSFER', purchaseId: partPurchase, referenceNo: 'NEFT-9' });
      expect(part.status).toBe(201);
      expect((await http().get(`/api/v1/purchases/${partPurchase}`).set(as(owner))).body.data).toMatchObject({ paidAmount: '500', creditAmount: '130' });
      expect(await outstanding()).toBe('1660');
    });

    it('supplier statement: running balance, and the credit purchases still open with overdue flags', async () => {
      const st = (await http().get(`/api/v1/suppliers/${supplier}/ledger?from=${addDaysStr(today, -30)}&to=${today}`).set(as(owner))).body.data;
      expect(st.closingBalance).toBe('1660');
      expect(st.outstanding).toBe('1660');
      expect(st.entries[0]).toMatchObject({ entryType: 'OPENING', debit: '500', balance: '500' });
      expect(st.entries.at(-1).balance).toBe('1660');
      expect(st.openPurchases.map((o: any) => o.creditAmount).sort()).toEqual(['130', '90', '940']); // 7-day, 10-day and 30-day credits
      expect(st.openPurchases.every((o: any) => o.overdue === false)).toBe(true);
      expect((await http().get(`/api/v1/suppliers/${supplier}/ledger`).set(as(mgr))).status).toBe(403);
    });

    it('rejecting a purchase gives the cash back and never touches stock or the supplier', async () => {
      const before = await stockOf(br, milk);
      const res = await buy(mgr, { locationId: br, supplierId: supplier, paymentMode: 'CASH', items: [line(milk, unitL, '5', '60')] });
      const id = res.body.data.id;
      expect((await http().get(`/api/v1/cash/reconciliation/${br}/${today}`).set(as(mgr))).body.data.cashPurchases).toBe('900'); // 600 + this 300
      expect((await http().post(`/api/v1/purchases/${id}/reject`).set(as(owner)).send({})).body.error.code).toBe('REASON_REQUIRED');
      await http().post(`/api/v1/purchases/${id}/reject`).set(as(owner)).send({ reason: 'Wrong rate' }).expect(200);
      expect((await http().get(`/api/v1/cash/reconciliation/${br}/${today}`).set(as(mgr))).body.data.cashPurchases).toBe('600');
      expect((await stockOf(br, milk)).quantity).toBe(before.quantity);
      expect(await outstanding()).toBe('1660');
      expect((await http().post(`/api/v1/purchases/${id}/approve`).set(as(owner))).status).toBe(409); // already decided
      // the manager can withdraw one that is still waiting
      const again = await buy(mgr, { locationId: br, supplierId: supplier, paymentMode: 'CASH', items: [line(milk, unitL, '1', '60')] });
      await http().post(`/api/v1/purchases/${again.body.data.id}/cancel`).set(as(mgr)).send({}).expect(200);
    });

    it('central warehouse: the stock manager buys within their limit; above it the owner must approve', async () => {
      const g0 = Number((await stockOf(godown, sugar))?.quantity ?? 0);
      const small = await buy(stockMgr, { locationId: godown, supplierId: supplier, paymentMode: 'CASH', items: [line(sugar, unitKg, '10', '45')] });
      expect(small.status).toBe(201);
      expect(small.body.data.approvalStatus).toBe('APPROVED'); // 450 <= their limit of 25,000
      expect(Number((await stockOf(godown, sugar)).quantity)).toBe(g0 + 10000);

      const big = await buy(stockMgr, { locationId: godown, supplierId: supplier, paymentMode: 'CREDIT', dueDate: addDaysStr(today, 15), items: [line(sugar, unitKg, '1000', '45')] });
      expect(big.body.data.approvalStatus).toBe('SUBMITTED'); // 45,000 is above it
      expect((await http().post(`/api/v1/purchases/${big.body.data.id}/approve`).set(as(stockMgr))).body.error.code).toBe('APPROVAL_LIMIT_EXCEEDED');
      expect(Number((await stockOf(godown, sugar)).quantity)).toBe(g0 + 10000); // still waiting: no stock yet
      await http().post(`/api/v1/purchases/${big.body.data.id}/approve`).set(as(owner)).expect(200);
      expect(Number((await stockOf(godown, sugar)).quantity)).toBe(g0 + 1010000);
    });

    it('reversal: refused while payments exist or stock is used; otherwise stock, ledger and cash are mirrored', async () => {
      // the part-paid purchase has a payment against it
      expect((await http().post(`/api/v1/purchases/${partPurchase}/reverse`).set(as(owner)).send({ reason: 'Wrong supplier' })).body.error.code).toBe('HAS_PAYMENTS');
      const payments = (await http().get(`/api/v1/purchases/${partPurchase}`).set(as(owner))).body.data.payments as any[];
      expect((await http().post(`/api/v1/suppliers/payments/${payments[0].id}/reverse`).set(as(owner)).send({})).body.error.code).toBe('REASON_REQUIRED');
      const oBefore = Number(await outstanding());
      await http().post(`/api/v1/suppliers/payments/${payments[0].id}/reverse`).set(as(owner)).send({ reason: 'Bounced' }).expect(200);
      expect((await http().get(`/api/v1/purchases/${partPurchase}`).set(as(owner))).body.data).toMatchObject({ paidAmount: '400', creditAmount: '230' });
      expect(Number(await outstanding())).toBe(oBefore + 100); // the 100 is owed again
      const o0 = Number(await outstanding());

      // now it can be reversed: 10 L of milk leave stock again and the 230 owed and 400 paid are undone
      const stockBefore = (await stockOf(br, milk)).quantity;
      await http().post(`/api/v1/purchases/${partPurchase}/reverse`).set(as(owner)).send({ reason: 'Wrong supplier' }).expect(200);
      expect(Number((await stockOf(br, milk)).quantity)).toBe(Number(stockBefore) - 10000);
      expect(Number(await outstanding())).toBe(o0 - 230); // the 630 purchase and the 400 paid with it are undone
      expect((await http().get(`/api/v1/purchases/${partPurchase}`).set(as(owner))).body.data.status).toBe('REVERSED');
      expect((await http().post(`/api/v1/purchases/${partPurchase}/reverse`).set(as(owner)).send({ reason: 'again' })).status).toBe(409);

      // the cash purchase: 10 L bought, and stock is still there, so its reversal returns 600 to the till
      const cashBefore = (await http().get(`/api/v1/cash/reconciliation/${br}/${today}`).set(as(owner))).body.data.expectedClosing;
      await http().post(`/api/v1/purchases/${cashPurchase}/reverse`).set(as(owner)).send({ reason: 'Returned to dairy' }).expect(200);
      const cashAfter = (await http().get(`/api/v1/cash/reconciliation/${br}/${today}`).set(as(owner))).body.data.expectedClosing;
      expect(Number(cashAfter) - Number(cashBefore)).toBe(600);
    });

    it('summary: totals, cash vs credit, by branch / supplier / item, and what is still owed', async () => {
      const r = (await http().get(`/api/v1/purchases/summary?locationId=${br}&from=${today}&to=${today}`).set(as(owner))).body.data;
      expect(r.groupBy).toBe('day');
      // live purchases at this branch today: credit 1,240 + sugar 90 (the cash and part purchases were reversed, the rejected one is out)
      expect(r.totals.total).toBe('1330');
      expect(r.totals.count).toBe(2);
      expect(r.locations).toHaveLength(1);
      expect(r.suppliers[0]).toMatchObject({ amount: '1330' });
      expect(r.items.map((i: any) => i.code)).toEqual(expect.arrayContaining(['ITM001', 'ITM004']));
      expect(Number(r.outstanding.total)).toBeGreaterThanOrEqual(Number(await outstanding()));
      expect(r.outstanding.suppliers).toBeGreaterThanOrEqual(1);
      expect(r.outstanding.overdue).toBeDefined();
      const mgrView = (await http().get('/api/v1/purchases/summary').set(as(mgr))).body.data;
      expect(mgrView.locations.every((l: any) => l.code === `PU${rnd}`)).toBe(true);
    });

    it('a repeated offline submission is applied once; offline purchases sync through the outbox', async () => {
      const clientUuid = randomUUID();
      const body = { locationId: br, supplierId: supplier, paymentMode: 'CASH', items: [line(milk, unitL, '2', '60')], clientUuid };
      const a = await buy(owner, body);
      const b = await buy(owner, body);
      expect(b.body.data.id).toBe(a.body.data.id);

      const uuid2 = randomUUID();
      const batch = await http().post('/api/v1/sync/batch').set(as(mgr)).send({
        deviceId: 'test-device',
        operations: [{ clientUuid: uuid2, entityType: 'PURCHASE', op: 'CREATE', payload: { locationId: br, businessDate: today, supplierId: supplier, paymentMode: 'CASH', items: [line(milk, unitL, '1', '60')] } }],
      });
      expect(batch.status).toBe(200);
      expect(batch.body.data.results[0].result).toBe('APPLIED');
      const dup = await http().post('/api/v1/sync/batch').set(as(mgr)).send({
        deviceId: 'test-device',
        operations: [{ clientUuid: uuid2, entityType: 'PURCHASE', op: 'CREATE', payload: { locationId: br, businessDate: today, supplierId: supplier, paymentMode: 'CASH', items: [line(milk, unitL, '1', '60')] } }],
      });
      expect(dup.body.data.results[0].result).toBe('DUPLICATE');
    });

    it('the supplier ledger is append-only: the application role cannot rewrite it', async () => {
      await expect(prisma.$executeRaw`UPDATE supplier_ledger SET debit = debit + 1 WHERE supplier_id = ${supplier}::uuid`).rejects.toBeTruthy();
    });
  });

  // ------------------------------------------------------------------ supplier management: profile, totals, items supplied, payment history, dues
  describe('supplier management', () => {
    let br: string;
    let mgr: string;
    let sup: string;
    let milk: string;
    let sugar: string;
    let tea: string;
    let unitL: string;
    let unitKg: string;
    const line = (itemId: string, unitId: string, quantity: string, rate: string) => ({ itemId, unitId, quantity, rate });
    const buy = (body: object) => http().post('/api/v1/purchases').set(as(owner)).send({ businessDate: today, paymentMode: 'CREDIT', ...body });
    const profile = async (token = owner) => (await http().get(`/api/v1/suppliers/${sup}`).set(as(token))).body.data;
    const pay = (amount: string, extra: object = {}) => http().post(`/api/v1/suppliers/${sup}/payments`).set(as(owner)).send({ locationId: br, amount, paymentMode: 'UPI', ...extra });

    beforeAll(async () => {
      const loc = await http().post('/api/v1/locations').set(as(owner)).send({ code: `SM${rnd}`, name: `Supplier Branch ${rnd}`, type: 'BRANCH', defaultOpeningCash: '1000.00' });
      br = loc.body.data.id;
      await http().post('/api/v1/users').set(as(owner)).send({ username: `smm${rnd}`, password: 'Test@12345', fullName: 'Supplier Mgr', roleCodes: ['BRANCH_MANAGER'], locationIds: [br] }).expect(201);
      mgr = (await login(`smm${rnd}`, 'Test@12345')).body.data.accessToken;
      const boot = (await http().get('/api/v1/sync/bootstrap').set(as(owner))).body.data;
      const item = (code: string) => boot.items.find((i: any) => i.code === code).id;
      milk = item('ITM001'); sugar = item('ITM004'); tea = item('ITM002');
      unitL = boot.units.find((u: any) => u.code === 'L').id;
      unitKg = boot.units.find((u: any) => u.code === 'KG').id;
    });

    it('a profile holds name, contact number, address, items supplied, payment terms and the opening balance', async () => {
      const c = await http().post('/api/v1/suppliers').set(as(owner)).send({
        name: `Profile Co ${rnd}`, contactPerson: 'Meena', phone: '9876500011', address: '12 Market Road\nChennai 600001', gstin: '33abcde1234f1z5',
        paymentTermsDays: 15, openingBalance: '800.00', openingBalanceDate: addDaysStr(today, -30), itemIds: [milk, sugar],
      });
      expect(c.status).toBe(201);
      sup = c.body.data.id;
      const p = await profile();
      expect(p).toMatchObject({ name: `Profile Co ${rnd}`, contactPerson: 'Meena', phone: '9876500011', paymentTermsDays: 15, openingBalance: '800', gstin: '33ABCDE1234F1Z5' });
      expect(p.address).toContain('Chennai');
      expect(p.items.map((i: any) => i.code).sort()).toEqual(['ITM001', 'ITM004']);
      expect(p.totals).toMatchObject({ openingBalance: '800', totalPurchases: '0', totalPaid: '0', outstanding: '800', purchaseCount: 0 });

      // items supplied can be replaced, and must be real active items
      await http().patch(`/api/v1/suppliers/${sup}`).set(as(owner)).send({ itemIds: [milk] }).expect(200);
      expect((await profile()).itemIds).toEqual([milk]);
      expect((await http().patch(`/api/v1/suppliers/${sup}`).set(as(owner)).send({ itemIds: [randomUUID()] })).body.error.code).toBe('INVALID_ITEM');
      expect((await profile()).itemIds).toEqual([milk]); // unchanged after the refusal
      await http().patch(`/api/v1/suppliers/${sup}`).set(as(owner)).send({ itemIds: [milk, sugar] }).expect(200);

      // a manager sees the profile but never the money
      const m = await profile(mgr);
      expect(m.name).toContain('Profile Co');
      expect(m.totals).toBeNull();
    });

    it('total purchases, total paid and outstanding always agree: opening + purchases - paid = outstanding', async () => {
      const b = await buy({ locationId: br, supplierId: sup, items: [line(milk, unitL, '10', '100')], dueDate: addDaysStr(today, 5) });
      expect(b.status).toBe(201);
      let t = (await profile()).totals;
      expect(t).toMatchObject({ totalPurchases: '1000', totalPaid: '0', outstanding: '1800', purchaseCount: 1 });

      await pay('300.00').then((r) => expect(r.status).toBe(201));
      t = (await profile()).totals;
      expect(t).toMatchObject({ totalPurchases: '1000', totalPaid: '300', outstanding: '1500', paymentCount: 1 });

      // 900 more: 700 settles the purchase, the last 200 is on account against the opening balance
      const r = await pay('900.00');
      expect(r.body.data.payments.map((p: any) => [p.purchaseId === null ? 'account' : 'purchase', p.amount])).toEqual([['purchase', '700'], ['account', '200']]);
      t = (await profile()).totals;
      expect(t).toMatchObject({ totalPurchases: '1000', totalPaid: '1200', outstanding: '600' });
      expect(Number(t.openingBalance) + Number(t.totalPurchases) - Number(t.totalPaid)).toBe(Number(t.outstanding));

      const row = ((await http().get('/api/v1/suppliers').set(as(owner))).body.data as any[]).find((s) => s.id === sup);
      expect(row).toMatchObject({ outstanding: '600', totalPurchases: '1000', totalPaid: '1200', itemCount: 2 });
      const seen = ((await http().get('/api/v1/suppliers').set(as(mgr))).body.data as any[]).find((s) => s.id === sup);
      expect(seen).toMatchObject({ outstanding: null, totalPurchases: null, totalPaid: null });
    });

    it('buying an item from a supplier adds it to the items they supply', async () => {
      expect((await profile()).itemIds).not.toContain(tea);
      await buy({ locationId: br, supplierId: sup, paymentMode: 'CASH', items: [line(tea, unitKg, '1', '480')] }).then((r) => expect(r.status).toBe(201));
      expect((await profile()).itemIds).toContain(tea);
    });

    it('payment history: every payment with supplier, paying location, purchase, mode, reference, and who paid; reversals are kept', async () => {
      const all = await http().get(`/api/v1/suppliers/payments?supplierId=${sup}`).set(as(owner));
      expect(all.status).toBe(200);
      const rows = all.body.data as any[];
      expect(rows).toHaveLength(3); // 300, 700 to the purchase, 200 on account
      expect(rows[0]).toMatchObject({ supplierName: `Profile Co ${rnd}`, locationCode: `SM${rnd}`, paymentMode: 'UPI', paidByName: 'Owner', status: 'ACTIVE' });
      expect(rows.filter((r) => r.purchaseCode)).toHaveLength(2);
      expect(all.body.meta.totalAmount).toBe('1200');

      const onAccount = rows.find((r) => !r.purchaseId);
      await http().post(`/api/v1/suppliers/payments/${onAccount.id}/reverse`).set(as(owner)).send({ reason: 'Wrong supplier' }).expect(200);
      const after = await http().get(`/api/v1/suppliers/payments?supplierId=${sup}`).set(as(owner));
      expect(after.body.data).toHaveLength(3); // kept, marked reversed
      expect(after.body.meta.totalAmount).toBe('1000'); // and no longer counted
      expect((await http().get(`/api/v1/suppliers/payments?supplierId=${sup}&status=REVERSED`).set(as(owner))).body.data).toHaveLength(1);
      expect((await http().get(`/api/v1/suppliers/payments?supplierId=${sup}&from=${addDaysStr(today, 1)}`).set(as(owner))).body.data).toHaveLength(0);
      expect((await http().get('/api/v1/suppliers/payments').set(as(mgr))).status).toBe(403);
    });

    it('due payments: overdue, due this week, later and no date, per supplier and per purchase', async () => {
      // three credit purchases: one already late, one due in 3 days, one due in 40 days
      const late = await buy({ locationId: br, supplierId: sup, businessDate: addDaysStr(today, -20), items: [line(sugar, unitKg, '10', '40')], dueDate: addDaysStr(today, -5) });
      expect(late.status).toBe(201);
      await buy({ locationId: br, supplierId: sup, items: [line(sugar, unitKg, '5', '40')], dueDate: addDaysStr(today, 3) }).then((r) => expect(r.status).toBe(201));
      await buy({ locationId: br, supplierId: sup, items: [line(sugar, unitKg, '1', '90')], dueDate: addDaysStr(today, 40) }).then((r) => expect(r.status).toBe(201));

      const d = (await http().get(`/api/v1/suppliers/dues?supplierId=${sup}`).set(as(owner))).body.data;
      expect(d.summary).toMatchObject({ overdue: '400', due7: '200', later: '90', suppliers: 1 });
      // the 200 paid on account was reversed in the previous step, so the whole 800 opening balance is owed with no purchase behind it
      expect(d.summary.onAccount).toBe('800');
      expect(d.summary.total).toBe(String(400 + 200 + 90 + 800));
      expect(d.suppliers[0]).toMatchObject({ code: expect.any(String), overdue: '400', due7: '200', later: '90', onAccount: '800' });
      expect(d.rows.map((r: any) => r.bucket)).toEqual(['overdue', 'due7', 'later']); // oldest due first
      expect(d.rows[0]).toMatchObject({ creditAmount: '400', daysOverdue: 5, locationCode: `SM${rnd}` });
      expect(d.rows[1].daysOverdue).toBe(-3);

      const only = (await http().get(`/api/v1/suppliers/dues?supplierId=${sup}&bucket=overdue`).set(as(owner))).body.data;
      expect(only.rows).toHaveLength(1);
      expect((await http().get('/api/v1/suppliers/dues').set(as(mgr))).status).toBe(403);
      // the same supplier's total in the list agrees with the report
      const row = ((await http().get('/api/v1/suppliers').set(as(owner))).body.data as any[]).find((s) => s.id === sup);
      expect(row.overdue).toBe('400');
      expect(row.outstanding).toBe(d.summary.total);
    });
  });

  // ------------------------------------------------------------------ inventory: opening + purchases + transfers - consumption - wastage = expected; physical count -> shortage / excess
  describe('inventory management', () => {
    let a: string; // branch A (has the stock we reconcile)
    let b: string; // branch B (receives a transfer)
    let gw: string; // a fresh central warehouse
    let mgrA: string;
    let mgrB: string;
    let supplier: string;
    let itemM: string; // milk-like, stock unit ml, bought in litres
    let itemS: string; // sugar-like, stock unit g, bought in kg
    let uL: string;
    let uKg: string;
    let uMl: string;
    let uG: string;
    let wasteBig: string;
    let countB: string;
    const date = today;
    const buy = (token: string, body: object) => http().post('/api/v1/purchases').set(as(token)).send({ businessDate: today, paymentMode: 'CASH', supplierId: supplier, ...body });
    const line = (itemId: string, unitId: string, quantity: string, rate: string) => ({ itemId, unitId, quantity, rate });
    const rec = async (loc: string, token = owner, d = date) => (await http().get(`/api/v1/stock/reconciliation?locationId=${loc}&date=${d}`).set(as(token)));
    const row = async (loc: string, item: string, token = owner, d = date) => ((await rec(loc, token, d)).body.data.rows as any[]).find((r) => r.itemId === item);
    /** The lines given, plus every item that must be counted daily (counted as the books expect), like a manager doing the full count. */
    const full = async (loc: string, token: string, lines: any[]) => {
      const rows = (await rec(loc, token)).body.data.rows as any[];
      const given = new Set(lines.map((l) => l.itemId));
      return [...lines, ...rows.filter((r) => r.dailyCountRequired && !given.has(r.itemId)).map((r) => ({ itemId: r.itemId, physicalQty: r.expected }))];
    };
    const photo = async (token: string, loc: string) => {
      const p = await http().post('/api/v1/attachments/presign').set(as(token)).send({ fileName: 'w.png', mimeType: 'image/png', sizeBytes: PNG.length, locationId: loc });
      await http().put(p.body.data.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
      return p.body.data.key as string;
    };

    beforeAll(async () => {
      const mk = async (code: string, type: string) => (await http().post('/api/v1/locations').set(as(owner)).send({ code, name: `Inv ${code}`, type, defaultOpeningCash: '1000.00' })).body.data.id as string;
      a = await mk(`IA${rnd}`, 'BRANCH'); b = await mk(`IB${rnd}`, 'BRANCH'); gw = await mk(`IG${rnd}`, 'GODOWN');
      const user = async (u: string, loc: string) => {
        await http().post('/api/v1/users').set(as(owner)).send({ username: u, password: 'Test@12345', fullName: `Mgr ${u}`, roleCodes: ['BRANCH_MANAGER'], locationIds: [loc] }).expect(201);
        return (await login(u, 'Test@12345')).body.data.accessToken as string;
      };
      mgrA = await user(`ima${rnd}`, a); mgrB = await user(`imb${rnd}`, b);
      supplier = (await http().post('/api/v1/suppliers').set(as(owner)).send({ name: `Inv Supplier ${rnd}` })).body.data.id;
      const boot = (await http().get('/api/v1/sync/bootstrap').set(as(owner))).body.data;
      uL = boot.units.find((u: any) => u.code === 'L').id; uKg = boot.units.find((u: any) => u.code === 'KG').id; uMl = boot.units.find((u: any) => u.code === 'ML').id;
      uG = boot.units.find((u: any) => u.code === 'G').id;
    });

    it('items are configurable: the owner adds them, units must fit, names are unique, managers cannot add', async () => {
      expect((await http().post('/api/v1/items').set(as(mgrA)).send({ nameEn: `X${rnd}`, category: 'DAIRY', baseUnitId: uMl })).status).toBe(403);
      const m = await http().post('/api/v1/items').set(as(owner)).send({ nameEn: `Test Milk ${rnd}`, nameTa: 'சோதனை பால்', category: 'Dairy', baseUnitId: uMl, purchaseUnitId: uL, isPerishable: true, dailyCountRequired: true, varianceThresholdPct: '5' });
      expect(m.status).toBe(201);
      expect(m.body.data.code).toMatch(/^ITM\d{3,}$/);
      expect(m.body.data.category).toBe('DAIRY');
      itemM = m.body.data.id;
      const s = await http().post('/api/v1/items').set(as(owner)).send({ nameEn: `Test Sugar ${rnd}`, category: 'GRAIN', baseUnitId: uG, purchaseUnitId: uKg });
      expect(s.status).toBe(201);
      itemS = s.body.data.id;
      expect((await http().post('/api/v1/items').set(as(owner)).send({ nameEn: `test milk ${rnd}`, category: 'DAIRY', baseUnitId: uMl })).status).toBe(409);
      expect((await http().post('/api/v1/items').set(as(owner)).send({ nameEn: `Bad ${rnd}`, category: 'DAIRY', baseUnitId: uMl, purchaseUnitId: uKg })).body.error.code).toBe('INVALID_UNIT'); // kg does not convert to ml
      const list = (await http().get('/api/v1/items').set(as(mgrA))).body.data as any[];
      const got = list.find((i) => i.id === itemM);
      expect(got).toMatchObject({ baseUnit: 'ML', purchaseUnit: 'L', displayUnit: 'L', displayFactor: '1000' });
      // every kind of item the brief asks for exists in the template list or can be added; per-location minimum stock
      await http().put(`/api/v1/items/${itemM}/locations/${a}`).set(as(owner)).send({ minStock: '20000' }).expect(200);
      expect((await http().put(`/api/v1/items/${itemM}/locations/${a}`).set(as(mgrA)).send({ minStock: '1' })).status).toBe(403);
    });

    it('opening stock and purchases: stock builds up in the ledger and the day starts from yesterday\'s close', async () => {
      await buy(owner, { locationId: a, businessDate: addDaysStr(today, -1), items: [line(itemM, uL, '100', '50')] }).then((r) => expect(r.status).toBe(201)); // 100 L
      await buy(owner, { locationId: a, items: [line(itemM, uL, '20', '50')] }).then((r) => expect(r.status).toBe(201)); // +20 L today
      await buy(owner, { locationId: gw, items: [line(itemM, uL, '50', '50')] }).then((r) => expect(r.status).toBe(201)); // the warehouse
      const r = await row(a, itemM);
      expect(r).toMatchObject({ opening: '100000', purchases: '20000', transfersIn: '0', transfersOut: '0', consumption: '0', wastage: '0', expected: '120000', unit: 'ML', displayUnit: 'L', physical: null });
    });

    it('transfers: request, approve, dispatch (stock leaves the sender), receive (arrives), short quantity is lost in transit with a reason', async () => {
      // a manager cannot request or send stock, and cannot receive at someone else's branch
      const body = { fromLocationId: gw, toLocationId: a, businessDate: today, items: [{ itemId: itemM, quantity: '10', unitId: uL }], vehicleRef: 'TN01AB1234', remarks: 'Weekly top-up' };
      expect((await http().post('/api/v1/transfers').set(as(mgrA)).send(body)).status).toBe(403);
      const t1 = await http().post('/api/v1/transfers').set(as(owner)).send(body);
      expect(t1.status).toBe(201);
      expect(t1.body.data).toMatchObject({ status: 'APPROVED', vehicleRef: 'TN01AB1234' }); // the owner can approve at once
      expect(t1.body.data.items[0].sentQty).toBe('10000');
      const id1 = t1.body.data.id;
      expect((await http().post(`/api/v1/transfers/${id1}/receive`).set(as(owner)).send({})).status).toBe(409); // not dispatched yet

      // more than the warehouse holds cannot be sent
      const big = await http().post('/api/v1/transfers').set(as(owner)).send({ ...body, items: [{ itemId: itemM, quantity: '9999', unitId: uL }] });
      expect((await http().post(`/api/v1/transfers/${big.body.data.id}/dispatch`).set(as(owner))).body.error.code).toBe('STOCK_INSUFFICIENT');
      await http().post(`/api/v1/transfers/${big.body.data.id}/cancel`).set(as(owner)).send({ reason: 'Too much' }).expect(200);

      await http().post(`/api/v1/transfers/${id1}/dispatch`).set(as(owner)).expect(200);
      expect((await row(gw, itemM)).transfersOut).toBe('10000');
      expect((await http().post(`/api/v1/transfers/${id1}/dispatch`).set(as(owner))).status).toBe(409); // once only
      expect((await http().post(`/api/v1/transfers/${id1}/receive`).set(as(mgrB)).send({})).status).toBe(404); // B cannot even see it (row-level security)
      await http().post(`/api/v1/transfers/${id1}/receive`).set(as(mgrA)).send({}).expect(200);
      expect((await http().get(`/api/v1/transfers/${id1}`).set(as(owner))).body.data.status).toBe('RECEIVED');
      expect((await row(a, itemM)).transfersIn).toBe('10000');

      // A sends 5 L on to B; B receives only 4.5 L and must say why
      const t2 = await http().post('/api/v1/transfers').set(as(owner)).send({ fromLocationId: a, toLocationId: b, businessDate: today, items: [{ itemId: itemM, quantity: '5', unitId: uL }] });
      await http().post(`/api/v1/transfers/${t2.body.data.id}/dispatch`).set(as(owner)).expect(200);
      expect((await http().post(`/api/v1/transfers/${t2.body.data.id}/receive`).set(as(mgrB)).send({ items: [{ itemId: itemM, receivedQty: '4500' }] })).body.error.code).toBe('REASON_REQUIRED');
      expect((await http().post(`/api/v1/transfers/${t2.body.data.id}/receive`).set(as(mgrB)).send({ items: [{ itemId: itemM, receivedQty: '6000', reason: 'x' }] })).body.error.code).toBe('RECEIVED_MORE');
      await http().post(`/api/v1/transfers/${t2.body.data.id}/receive`).set(as(mgrB)).send({ items: [{ itemId: itemM, receivedQty: '4500', reason: 'SPILLED' }] }).expect(200);
      const done = (await http().get(`/api/v1/transfers/${t2.body.data.id}`).set(as(owner))).body.data;
      expect(done.status).toBe('PARTIALLY_RECEIVED');
      expect(done.items[0]).toMatchObject({ sentQty: '5000', receivedQty: '4500', varianceReason: 'SPILLED' });
      expect(done.lostValue).toBe('25'); // 500 ml at 0.05
      expect((await row(a, itemM)).transfersOut).toBe('5000');
      expect((await row(b, itemM)).transfersIn).toBe('4500');
      expect((await http().get(`/api/v1/transfers?locationId=${b}`).set(as(mgrB))).body.data.map((t: any) => t.code)).toContain(done.code);
      // the receiving manager sees the sender's name too, although the warehouse is outside their own scope
      const seen = (await http().get(`/api/v1/transfers?locationId=${a}`).set(as(mgrA))).body.data.find((t: any) => t.toLocationId === b);
      expect(seen.toLocationName).toBe(`Inv IB${rnd}`);
      expect((await http().get(`/api/v1/transfers?locationId=${a}`).set(as(mgrA))).body.data.find((t: any) => t.id === id1).fromLocationName).toBe(`Inv IG${rnd}`);
    });

    it('consumption: what was used is set per item and can be corrected; a change is a new ledger row, never an edit', async () => {
      const set = (qty: string, token = mgrA, loc = a) => http().put('/api/v1/stock/consumption').set(as(token)).send({ locationId: loc, businessDate: today, items: [{ itemId: itemM, quantity: qty }] });
      expect((await set('30000')).status).toBe(200);
      expect((await row(a, itemM)).consumption).toBe('30000');
      expect((await set('25000')).body.data.changed).toBe(1);
      expect((await row(a, itemM)).consumption).toBe('25000'); // corrected down: the day nets to 25 L
      expect((await set('25000')).body.data.changed).toBe(0); // no change, nothing posted
      await set('30000');
      expect((await row(a, itemM)).consumption).toBe('30000');
      expect((await set('1000', mgrA, b)).status).toBe(403); // B is not A's manager
      // more used than the books hold is allowed but flagged
      const warn = await set('999999999'.slice(0, 6), mgrB, b);
      expect(warn.status).toBe(200);
      expect(warn.body.data.warnings.map((w: any) => w.code)).toContain('NEGATIVE_STOCK');
      await set('0', mgrB, b);
    });

    it('wastage: stock goes down at once, a photo is needed for larger losses, approval decides if the loss is accepted; a rejected one gives the stock back', async () => {
      const w = (qty: string, extra: object = {}) => http().post('/api/v1/wastage').set(as(mgrA)).send({ locationId: a, businessDate: today, itemId: itemM, quantity: qty, unitId: uL, reason: 'SPOILED', ...extra });
      const small = await w('2'); // 2 L = 100 at 0.05: within the manager's limit of 200
      expect(small.status).toBe(201);
      expect(small.body.data).toMatchObject({ approvalStatus: 'APPROVED', estimatedValue: '100', baseQuantity: '2000' });
      expect((await w('6')).body.error.code).toBe('PHOTO_REQUIRED'); // 300 is above the photo threshold
      const big = await w('6', { attachmentKeys: [await photo(mgrA, a)], reasonNote: 'Fridge failed' });
      expect(big.status).toBe(201);
      expect(big.body.data.approvalStatus).toBe('SUBMITTED'); // 300 is above the manager's limit
      wasteBig = big.body.data.id;
      expect((await row(a, itemM)).wastage).toBe('8000'); // both are out of stock already

      expect((await http().post(`/api/v1/wastage/${wasteBig}/approve`).set(as(mgrA))).status).toBe(403);
      expect((await http().post(`/api/v1/wastage/${wasteBig}/reject`).set(as(owner)).send({})).body.error.code).toBe('REASON_REQUIRED');
      await http().post(`/api/v1/wastage/${wasteBig}/reject`).set(as(owner)).send({ reason: 'Fridge log shows it was fine' }).expect(200);
      expect((await row(a, itemM)).wastage).toBe('2000'); // the 6 L is back on the books: a shortage will show at the count

      const list = (await http().get(`/api/v1/wastage?locationId=${a}`).set(as(owner))).body;
      const rejected = list.data.find((x: any) => x.id === wasteBig);
      expect(rejected).toMatchObject({ approvalStatus: 'REJECTED', rejectionReason: 'Fridge log shows it was fine', itemName: `Test Milk ${rnd}`, unitCode: 'L', enteredByName: expect.any(String), receiptCount: 1 });
      expect(list.meta.totalValue).toBe('100'); // rejected entries are not counted
      const cancelMe = await w('1');
      expect(cancelMe.body.data.approvalStatus).toBe('APPROVED');
      expect((await http().post(`/api/v1/wastage/${cancelMe.body.data.id}/cancel`).set(as(mgrA)).send({})).status).toBe(409); // approved ones cannot be cancelled
      await http().post(`/api/v1/wastage/${cancelMe.body.data.id}/reverse`).set(as(owner)).send({}).catch(() => undefined);
    });

    it('expected closing = opening + purchases + transfers in - transfers out - consumption - wastage', async () => {
      // A: opening 100,000 + purchases 20,000 + in 10,000 - out 5,000 - consumption 30,000 - wastage 3,000 (2 L + the 1 L approved above)
      const r = await row(a, itemM);
      expect(r).toMatchObject({ opening: '100000', purchases: '20000', transfersIn: '10000', transfersOut: '5000', consumption: '30000', wastage: '3000', other: '0', adjustment: '0', expected: '92000' });
      expect(Number(r.avgCost)).toBeCloseTo(0.05, 4);
      const day = (await rec(a)).body.data;
      expect(day.totals.wastageValue).toBe('150');
      expect(day.rows.length).toBeGreaterThanOrEqual(2); // both new items are tracked here
      // managers only see their own branch; the day before is what today opened with
      expect((await rec(b, mgrA)).status).toBe(403);
      expect(await row(a, itemM, owner, addDaysStr(today, -1))).toMatchObject({ opening: '0', purchases: '100000', expected: '100000' });
    });

    it('physical count: a small difference is a shortage that is accepted at once and corrects the books', async () => {
      const save = async (lines: object[], token = mgrA, loc = a, complete = true) => {
        const items = complete ? await full(loc, token, lines) : lines;
        return http().put(`/api/v1/stock/counts/${loc}/${today}`).set(as(token)).send({ items });
      };
      // counting only some of the daily items is refused when the count is sent in
      await save([{ itemId: itemM, physicalQty: '91000' }], mgrA, a, false).then((r) => expect(r.status).toBe(200));
      const incomplete = await http().post(`/api/v1/stock/counts/${a}/${today}/submit`).set(as(mgrA));
      expect(incomplete.status).toBe(422);
      expect(incomplete.body.error.code).toBe('COUNT_INCOMPLETE');
      const saved = await save([{ itemId: itemM, physicalQty: '91000' }]); // 1 L short of 92 L: ~1.1%, under the 5% threshold
      expect(saved.status).toBe(200);
      expect(saved.body.data).toMatchObject({ status: 'IN_PROGRESS', significant: 0 });
      const draft = await row(a, itemM);
      expect(draft).toMatchObject({ physical: '91000', variance: '-1000', varianceValue: '-50', label: 'SHORTAGE' });
      // every item that must be counted daily has to be in: the milk-like item is one; it is counted here
      const sub = await http().post(`/api/v1/stock/counts/${a}/${today}/submit`).set(as(mgrA));
      expect(sub.status).toBe(200);
      expect(sub.body.data.status).toBe('APPROVED'); // no significant difference: nothing to approve

      const after = await row(a, itemM);
      expect(after).toMatchObject({ expected: '92000', physical: '91000', variance: '-1000', label: 'SHORTAGE', adjustment: '-1000' });
      // the books now say what was physically there
      const level = ((await http().get(`/api/v1/stock?locationId=${a}`).set(as(owner))).body.data as any[]).find((x) => x.itemId === itemM);
      expect(level.quantity).toBe('91000');
      // an approved count is final for the day
      expect((await save([{ itemId: itemM, physicalQty: '90000' }])).body.error.code).toBe('COUNT_APPROVED');
      expect((await http().put('/api/v1/stock/consumption').set(as(mgrA)).send({ locationId: a, businessDate: today, items: [{ itemId: itemM, quantity: '1' }] })).body.error.code).toBe('COUNT_APPROVED');
      // tomorrow opens from what was counted
      const totals = (await rec(a)).body.data.totals;
      expect(Number(totals.shortageValue)).toBeCloseTo(50, 1);
    });

    it('a significant difference needs a reason and an explanation, waits for the owner, and can be sent back for a re-count', async () => {
      await buy(owner, { locationId: b, items: [line(itemM, uL, '10', '50'), line(itemS, uKg, '10', '40')] }).then((r) => expect(r.status).toBe(201));
      // B: milk expected 4,500 (transfer, after loss) + 10,000 (purchase) = 14,500; sugar 10,000 g
      expect(await row(b, itemM)).toMatchObject({ transfersIn: '4500', purchases: '10000', expected: '14500' });
      const save = async (lines: object[]) => {
        const items = await full(b, mgrB, lines);
        return http().put(`/api/v1/stock/counts/${b}/${today}`).set(as(mgrB)).send({ items });
      };
      // milk counted 12,000: 2,500 short (17%) - significant; sugar counted 10,500: 5% over, right at the limit - not significant
      const s = await save([{ itemId: itemM, physicalQty: '12000' }, { itemId: itemS, physicalQty: '10500' }]);
      expect(s.body.data.significant).toBe(1);
      const sub = await http().post(`/api/v1/stock/counts/${b}/${today}/submit`).set(as(mgrB));
      expect(sub.status).toBe(422);
      expect(sub.body.error.code).toBe('VARIANCE_REASON_REQUIRED');
      await save([{ itemId: itemM, physicalQty: '12000', reason: 'SPILLAGE', explanation: 'Two cans split during delivery' }, { itemId: itemS, physicalQty: '10500' }]);
      const sent = await http().post(`/api/v1/stock/counts/${b}/${today}/submit`).set(as(mgrB));
      expect(sent.body.data.status).toBe('SUBMITTED'); // the manager cannot approve their own count
      countB = sent.body.data.id;
      expect((await row(b, itemM)).physical).toBe('12000');
      expect(((await http().get(`/api/v1/stock?locationId=${b}`).set(as(owner))).body.data as any[]).find((x) => x.itemId === itemM).quantity).toBe('14500'); // books unchanged until approved
      expect((await save([{ itemId: itemM, physicalQty: '1' }])).body.error.code).toBe('COUNT_SUBMITTED');
      expect((await http().post(`/api/v1/stock/counts/${countB}/approve`).set(as(mgrB))).status).toBe(403);

      // sent back: the manager re-counts
      expect((await http().post(`/api/v1/stock/counts/${countB}/reject`).set(as(owner)).send({})).body.error.code).toBe('COMMENT_REQUIRED');
      await http().post(`/api/v1/stock/counts/${countB}/reject`).set(as(owner)).send({ comment: 'Count the milk cans again' }).expect(200);
      const rd = (await rec(b)).body.data;
      expect(rd.count).toMatchObject({ status: 'REJECTED', reviewComment: 'Count the milk cans again' });
      await save([{ itemId: itemM, physicalQty: '12500', reason: 'SPILLAGE', explanation: 'Recounted; two cans split' }, { itemId: itemS, physicalQty: '10500' }]);
      const again = await http().post(`/api/v1/stock/counts/${b}/${today}/submit`).set(as(mgrB));
      expect(again.body.data.status).toBe('SUBMITTED');
      await http().post(`/api/v1/stock/counts/${countB}/approve`).set(as(owner)).expect(200);
      expect(await row(b, itemM)).toMatchObject({ expected: '14500', physical: '12500', variance: '-2000', label: 'SHORTAGE', adjustment: '-2000' });
      expect(await row(b, itemS)).toMatchObject({ expected: '10000', physical: '10500', variance: '500', label: 'EXCESS', adjustment: '500' });
      const lv = ((await http().get(`/api/v1/stock?locationId=${b}`).set(as(owner))).body.data as any[]);
      expect(lv.find((x) => x.itemId === itemM).quantity).toBe('12500');
      expect(lv.find((x) => x.itemId === itemS).quantity).toBe('10500');
    });

    it('variance report: shortage, excess and wastage in a period, by item and location, with the reason and who counted', async () => {
      const rep = (await http().get(`/api/v1/stock/variance-report?from=${today}&to=${today}&locationId=${b}`).set(as(owner))).body.data;
      expect(rep.summary).toMatchObject({ shortageCount: 1, excessCount: 1 });
      expect(rep.summary.shortageValue).toBe('100'); // 2,000 ml at 0.05
      expect(rep.summary.excessValue).toBe('20'); // 500 g at 0.04
      expect(rep.summary.net).toBe('-80');
      const short = rep.rows.find((r: any) => r.label === 'SHORTAGE');
      expect(short).toMatchObject({ itemName: `Test Milk ${rnd}`, unit: 'ML', expected: '14500', physical: '12500', variance: '-2000', reason: 'SPILLAGE', isSignificant: true, status: 'APPROVED', countedBy: expect.any(String) });
      expect(rep.byItem[0]).toMatchObject({ shortageValue: '100' });
      expect(rep.byLocation).toHaveLength(1);

      const onlyShort = (await http().get(`/api/v1/stock/variance-report?from=${today}&to=${today}&locationId=${b}&type=shortage`).set(as(owner))).body.data;
      expect(onlyShort.rows).toHaveLength(1);
      expect((await http().get(`/api/v1/stock/variance-report?from=${today}&to=${today}&locationId=${b}&type=excess`).set(as(owner))).body.data.rows[0].itemName).toBe(`Test Sugar ${rnd}`);

      // branch A: the 1 L shortage and 3 L (150) of accepted wastage
      const ra = (await http().get(`/api/v1/stock/variance-report?from=${today}&to=${today}&locationId=${a}`).set(as(owner))).body.data;
      expect(ra.summary).toMatchObject({ shortageCount: 1, shortageValue: '50', wastageValue: '150' });
      // the list of counts, for approvals
      const counts = (await http().get(`/api/v1/stock/counts?locationId=${b}`).set(as(owner))).body.data as any[];
      expect(counts[0]).toMatchObject({ status: 'APPROVED', significant: 1, locationCode: `IB${rnd}` });
      // a manager reads only their own branch
      expect((await http().get(`/api/v1/stock/variance-report?from=${today}&to=${today}&locationId=${b}`).set(as(mgrA))).status).toBe(403);
      expect((await http().get(`/api/v1/stock/variance-report?from=${today}&to=${addDaysStr(today, -1)}`).set(as(owner))).status).toBe(422);
    });

    it('wastage summary: total, by reason, item and branch, and over time', async () => {
      const s = (await http().get(`/api/v1/wastage/summary?locationId=${a}&from=${today}&to=${today}`).set(as(owner))).body.data;
      expect(s.totals.value).toBe('150');
      expect(s.byReason[0]).toMatchObject({ reason: 'SPOILED', value: '150', sharePct: 100 });
      expect(s.byItem[0]).toMatchObject({ name: `Test Milk ${rnd}`, value: '150' });
      expect(s.buckets).toHaveLength(1);
    });

    it('offline wastage entries sync through the outbox and are applied once', async () => {
      const uuid = randomUUID();
      const op = { clientUuid: uuid, entityType: 'WASTAGE', op: 'CREATE', payload: { locationId: a, businessDate: addDaysStr(today, -1), itemId: itemM, quantity: '1', unitId: uL, reason: 'EXPIRED' } };
      const first = await http().post('/api/v1/sync/batch').set(as(mgrA)).send({ deviceId: 'inv-device', operations: [op] });
      expect(first.body.data.results[0].result).toBe('APPLIED');
      const dup = await http().post('/api/v1/sync/batch').set(as(mgrA)).send({ deviceId: 'inv-device', operations: [op] });
      expect(dup.body.data.results[0].result).toBe('DUPLICATE');
    });
  });

  // ------------------------------------------------------------------ recipe / cost management
  describe('recipe / cost management', () => {
    let loc: string;
    let supplierId: string;
    let itemMilk: string, itemSugar: string, itemCup: string;
    let uL2: string, uMl2: string, uG2: string, uKg2: string, uPcs2: string;
    let recipeId: string;

    beforeAll(async () => {
      loc = (await http().post('/api/v1/locations').set(as(owner)).send({ code: `RC${rnd}`, name: `Recipe Test ${rnd}`, type: 'BRANCH', defaultOpeningCash: '500.00' })).body.data.id;
      supplierId = (await http().post('/api/v1/suppliers').set(as(owner)).send({ name: `Recipe Supplier ${rnd}` })).body.data.id;
      const boot = (await http().get('/api/v1/sync/bootstrap').set(as(owner))).body.data;
      uL2 = boot.units.find((u: any) => u.code === 'L').id; uMl2 = boot.units.find((u: any) => u.code === 'ML').id;
      uG2 = boot.units.find((u: any) => u.code === 'G').id; uKg2 = boot.units.find((u: any) => u.code === 'KG').id;
      uPcs2 = boot.units.find((u: any) => u.code === 'PCS').id;

      itemMilk = (await http().post('/api/v1/items').set(as(owner)).send({ nameEn: `Recipe Milk ${rnd}`, category: 'DAIRY', baseUnitId: uMl2, purchaseUnitId: uL2 })).body.data.id;
      itemSugar = (await http().post('/api/v1/items').set(as(owner)).send({ nameEn: `Recipe Sugar ${rnd}`, category: 'GRAIN', baseUnitId: uG2, purchaseUnitId: uKg2 })).body.data.id;
      itemCup = (await http().post('/api/v1/items').set(as(owner)).send({ nameEn: `Recipe Cup ${rnd}`, category: 'PACKAGING', baseUnitId: uPcs2 })).body.data.id;

      // one purchase each, at one location, so the company-wide average cost is exactly this purchase's rate
      const buy = (itemId: string, unitId: string, quantity: string, rate: string) =>
        http().post('/api/v1/purchases').set(as(owner)).send({ locationId: loc, businessDate: today, paymentMode: 'CASH', supplierId, items: [{ itemId, unitId, quantity, rate }] });
      await buy(itemMilk, uL2, '10', '60').then((r) => expect(r.status).toBe(201)); // 60/L -> 0.06/ml
      await buy(itemSugar, uKg2, '5', '40').then((r) => expect(r.status).toBe(201)); // 40/kg -> 0.04/g
      await buy(itemCup, uPcs2, '100', '0.50').then((r) => expect(r.status).toBe(201)); // 0.50 each
    });

    it('is management accounting, not billing: a manager cannot define recipes; the owner can, priced from current purchase rates', async () => {
      const body = {
        nameEn: `Test Tea ${rnd}`, yieldQty: '1', sellingPrice: '15',
        items: [{ itemId: itemMilk, quantity: '90', unitId: uMl2 }, { itemId: itemSugar, quantity: '8', unitId: uG2 }, { itemId: itemCup, quantity: '1', unitId: uPcs2 }],
      };
      expect((await http().post('/api/v1/recipes').set(as(manager)).send(body)).status).toBe(403);
      const created = await http().post('/api/v1/recipes').set(as(owner)).send(body);
      expect(created.status).toBe(201);
      expect(created.body.data.code).toMatch(/^RCP\d{3,}$/);
      recipeId = created.body.data.id;

      // 90ml milk @0.06 = 5.40, 8g sugar @0.04 = 0.32, 1 cup @0.50 = 0.50 -> total 6.22
      const detail = (await http().get(`/api/v1/recipes/${recipeId}`).set(as(owner))).body.data;
      expect(detail.totalCost).toBe('6.22');
      expect(detail.costPerUnit).toBe('6.22'); // yield is 1
      expect(detail.marginPct).toBe('58.5'); // (15 - 6.22) / 15
      expect(detail.breakdown).toHaveLength(3);
      expect(detail.breakdown.find((b: any) => b.itemId === itemMilk)).toMatchObject({ lineCost: '5.4', unitCost: '0.06' });
    });

    it('recipes appear in the list with the same live cost; a branch manager can neither see nor change them', async () => {
      expect((await http().get('/api/v1/recipes').set(as(manager))).status).toBe(403);
      const list = (await http().get('/api/v1/recipes').set(as(owner))).body.data as any[];
      expect(list.find((r) => r.id === recipeId)).toMatchObject({ totalCost: '6.22', ingredientCount: 3 });
      expect((await http().patch(`/api/v1/recipes/${recipeId}`).set(as(manager)).send({ sellingPrice: '20' })).status).toBe(403);
    });

    it('changing a quantity changes the estimated cost; a duplicate name or ingredient is rejected', async () => {
      const dupName = await http().post('/api/v1/recipes').set(as(owner)).send({ nameEn: `Test Tea ${rnd}`, yieldQty: '1', items: [{ itemId: itemMilk, quantity: '1', unitId: uMl2 }] });
      expect(dupName.status).toBe(409);
      const dupItem = await http().patch(`/api/v1/recipes/${recipeId}`).set(as(owner)).send({ items: [{ itemId: itemMilk, quantity: '90', unitId: uMl2 }, { itemId: itemMilk, quantity: '5', unitId: uG2 }] });
      expect(dupItem.body.error.code).toBe('DUPLICATE_ITEM');
      const updated = await http().patch(`/api/v1/recipes/${recipeId}`).set(as(owner)).send({
        items: [{ itemId: itemMilk, quantity: '180', unitId: uMl2 }, { itemId: itemSugar, quantity: '8', unitId: uG2 }, { itemId: itemCup, quantity: '1', unitId: uPcs2 }],
      });
      expect(updated.status).toBe(200);
      const detail = (await http().get(`/api/v1/recipes/${recipeId}`).set(as(owner))).body.data;
      expect(detail.totalCost).toBe('11.62'); // milk doubled: 10.80 + 0.32 + 0.50
    });

    it('every change snapshots today\'s cost, so the cost-trend report has a point to show and a % change since the range started', async () => {
      const svc = app.get(RecipesService);
      await svc.snapshotAll(); // same as the nightly job; idempotent for a day already snapshotted by create/update
      const trend = (await http().get(`/api/v1/recipes/${recipeId}/cost-trend?from=${today}&to=${today}`).set(as(owner))).body.data;
      expect(trend.points).toHaveLength(1);
      expect(trend.points[0].costPerUnit).toBe('11.62');
      expect(trend.change).toBeTruthy();
      expect(Number(trend.change.changePct)).toBe(0); // only one day of history so far: no change to report yet
    });

    it('a raw material\'s own purchase-price trend, independent of any recipe', async () => {
      const trend = (await http().get(`/api/v1/recipes/raw-material-cost-trend?itemId=${itemMilk}&from=${today}&to=${today}`).set(as(owner))).body.data;
      expect(trend.points).toEqual([{ date: today, unitCost: '0.06' }]);
      expect((await http().get(`/api/v1/recipes/raw-material-cost-trend?itemId=${itemMilk}`).set(as(manager))).status).toBe(403);
    });
  });

  // ------------------------------------------------------------------ employee management
  describe('employee management', () => {
    let eloc: string;
    let mgrE: string;
    let accountant: string;
    let empId: string;
    const month = today.slice(0, 7);

    beforeAll(async () => {
      eloc = (await http().post('/api/v1/locations').set(as(owner)).send({ code: `EL${rnd}`, name: `Emp Test ${rnd}`, type: 'BRANCH', defaultOpeningCash: '500.00' })).body.data.id;
      await http().post('/api/v1/users').set(as(owner)).send({ username: `eme${rnd}`, password: 'Test@12345', fullName: 'Emp Mgr', roleCodes: ['BRANCH_MANAGER'], locationIds: [eloc] }).expect(201);
      mgrE = (await login(`eme${rnd}`, 'Test@12345')).body.data.accessToken;
      accountant = (await login('accountant')).body.data.accessToken;
    });

    it('is management data, not recruitment: only the owner creates employee records, with every requested field', async () => {
      const body = {
        fullName: `Test Waiter ${rnd}`, locationId: eloc, jobRole: 'Waiter', phone: '9876500000', joiningDate: addDaysStr(today, -60),
        salaryType: 'DAILY', baseSalary: '500', overtimeRatePerHour: '50',
      };
      expect((await http().post('/api/v1/employees').set(as(mgrE)).send(body)).status).toBe(403);
      const created = await http().post('/api/v1/employees').set(as(owner)).send(body);
      expect(created.status).toBe(201);
      expect(created.body.data.code).toMatch(/^EMP\d{6,}$/);
      expect(created.body.data.hasBankDetails).toBe(false);
      empId = created.body.data.id;

      // BANK/UPI payment needs bank details; a manager can view the roster but not the record's money terms beyond that
      const noBank = await http().post('/api/v1/employees').set(as(owner)).send({ ...body, fullName: `Test Bank ${rnd}`, paymentMethod: 'BANK' });
      expect(noBank.body.error.code).toBe('BANK_DETAILS_REQUIRED');
      const withBank = await http().post('/api/v1/employees').set(as(owner)).send({
        ...body, fullName: `Test Bank2 ${rnd}`, paymentMethod: 'BANK', bankDetails: { accountHolder: 'Test Waiter', accountNumber: '1234567890', ifsc: 'HDFC0001234' },
      });
      expect(withBank.status).toBe(201);
      expect(withBank.body.data.hasBankDetails).toBe(true);
      expect(JSON.stringify(withBank.body.data)).not.toContain('1234567890'); // never in a normal response
      const bankId = withBank.body.data.id;
      expect((await http().get(`/api/v1/employees/${bankId}/bank-details`).set(as(accountant))).status).toBe(403); // staff:view only, not staff:manage
      const decrypted = (await http().get(`/api/v1/employees/${bankId}/bank-details`).set(as(owner))).body.data;
      expect(decrypted).toMatchObject({ accountNumber: '1234567890', ifsc: 'HDFC0001234' });
    });

    it('attendance: a roster the branch manager marks day by day, present/absent/leave/half-day/overtime, corrected in place', async () => {
      const mark = (token: string, businessDate: string, items: any[]) => http().put('/api/v1/attendance').set(as(token)).send({ locationId: eloc, businessDate, items });
      await mark(owner, today, [{ employeeId: empId, status: 'PRESENT', overtimeHours: '2' }]).then((r) => expect(r.status).toBe(200));
      await mark(mgrE, addDaysStr(today, -1), [{ employeeId: empId, status: 'HALF_DAY' }]).then((r) => expect(r.status).toBe(200));
      const roster = (await http().get(`/api/v1/attendance/roster?locationId=${eloc}&date=${today}`).set(as(mgrE))).body.data as any[];
      expect(roster.find((r) => r.employeeId === empId)).toMatchObject({ status: 'PRESENT', overtimeHours: '2' });
      // correcting the same day is an upsert, not a new row
      await mark(owner, today, [{ employeeId: empId, status: 'ABSENT' }]).then((r) => expect(r.status).toBe(200));
      const history = (await http().get(`/api/v1/attendance/history?employeeId=${empId}&from=${addDaysStr(today, -1)}&to=${today}`).set(as(owner))).body.data as any[];
      expect(history).toHaveLength(2);
      expect(history.find((h: any) => h.businessDate.slice(0, 10) === today)?.status).toBe('ABSENT');
      // put it back to PRESENT + 2h overtime for the payroll math below
      await mark(owner, today, [{ employeeId: empId, status: 'PRESENT', overtimeHours: '2' }]).then((r) => expect(r.status).toBe(200));
    });

    let advanceId: string;
    it('advance workflow: employee request -> manager approval -> owner/accountant approval -> payment, cash leaves the till', async () => {
      const reqBody = { employeeId: empId, amount: '1000', reason: 'Medical emergency', monthlyRecovery: '200' };
      expect((await http().post('/api/v1/advances').set(as(accountant)).send(reqBody)).status).toBe(403); // accountant cannot request, only manager/staff
      const req = await http().post('/api/v1/advances').set(as(mgrE)).send(reqBody);
      expect(req.status).toBe(201);
      expect(req.body.data.code).toMatch(/^ADV-/);
      advanceId = req.body.data.id;

      expect((await http().post(`/api/v1/advances/${advanceId}/approve`).set(as(accountant))).status).toBe(409); // not manager-approved yet
      expect((await http().post(`/api/v1/advances/${advanceId}/manager-approve`).set(as(accountant))).status).toBe(403); // accountant lacks manager_approve
      await http().post(`/api/v1/advances/${advanceId}/manager-approve`).set(as(mgrE)).expect(200);
      expect((await http().post(`/api/v1/advances/${advanceId}/approve`).set(as(mgrE))).status).toBe(403); // manager cannot give the final approval
      await http().post(`/api/v1/advances/${advanceId}/approve`).set(as(accountant)).expect(200);

      const paid = await http().post(`/api/v1/advances/${advanceId}/pay`).set(as(accountant)).send({ paymentMode: 'CASH' });
      expect(paid.status).toBe(200);
      expect(paid.body.data).toMatchObject({ status: 'PAID', paidAmount: '1000', remainingAmount: '1000' });
      const txns = (await http().get(`/api/v1/cash/transactions?locationId=${eloc}&date=${paid.body.data.paidOn.slice(0, 10)}`).set(as(owner))).body.data as any[];
      expect(txns.find((t: any) => t.txnType === 'ADVANCE_PAYMENT')).toMatchObject({ amount: '1000', direction: -1 });
    });

    it('salary: basic (daily rate x present days) + overtime - advance recovery = payable, approved then paid', async () => {
      expect((await http().post('/api/v1/salary/compute').set(as(mgrE)).send({ employeeId: empId, month })).status).toBe(403); // payroll is owner/accountant only
      const computed = await http().post('/api/v1/salary/compute').set(as(accountant)).send({ employeeId: empId, month });
      expect(computed.status).toBe(201);
      // 1 present (500) + 1 half-day (250) = 750 basic; 2h overtime x 50 = 100; minus 200 advance recovery = 650
      expect(computed.body.data).toMatchObject({ presentDays: '1.5', overtimeHours: '2', basicEarned: '750', overtimeAmount: '100', advanceRecovery: '200', payable: '650', approvalStatus: 'DRAFT' });
      const salaryId = computed.body.data.id;

      expect((await http().get('/api/v1/salary').set(as(mgrE))).status).toBe(403);
      const listed = (await http().get(`/api/v1/salary?employeeId=${empId}&month=${month}`).set(as(accountant))).body.data as any[];
      expect(listed[0]).toMatchObject({ id: salaryId, employeeCode: expect.any(String) });

      await http().post(`/api/v1/salary/${salaryId}/pay`).set(as(accountant)).send({ amount: '650', paymentMode: 'BANK_TRANSFER' }).then((r) => expect(r.status).toBe(409)); // not approved yet
      await http().post(`/api/v1/salary/${salaryId}/approve`).set(as(accountant)).expect(200);
      const paid = await http().post(`/api/v1/salary/${salaryId}/pay`).set(as(accountant)).send({ amount: '650', paymentMode: 'BANK_TRANSFER' });
      expect(paid.status).toBe(200);
      expect(paid.body.data).toMatchObject({ paymentStatus: 'PAID', paidAmount: '650' });

      // paying the salary in full actually recovers the advance: 1000 - 200 = 800 remaining
      const advance = (await http().get(`/api/v1/advances/${advanceId}`).set(as(owner))).body.data;
      expect(advance).toMatchObject({ status: 'PAID', recoveredAmount: '200', remainingAmount: '800' });
      expect(advance.repayments).toHaveLength(1);
      expect(advance.repayments[0]).toMatchObject({ amount: '200', mode: 'SALARY', salaryId });
    });

    it('a direct cash repayment (outside payroll) closes the advance once nothing remains', async () => {
      const req = await http().post('/api/v1/advances').set(as(mgrE)).send({ employeeId: empId, amount: '300', reason: 'Second advance' });
      await http().post(`/api/v1/advances/${req.body.data.id}/manager-approve`).set(as(mgrE)).expect(200);
      await http().post(`/api/v1/advances/${req.body.data.id}/approve`).set(as(accountant)).expect(200);
      await http().post(`/api/v1/advances/${req.body.data.id}/pay`).set(as(accountant)).send({ paymentMode: 'UPI' }).expect(200);
      const repaid = await http().post(`/api/v1/advances/${req.body.data.id}/repay`).set(as(accountant)).send({ amount: '300' });
      expect(repaid.status).toBe(200);
      expect(repaid.body.data).toMatchObject({ status: 'CLOSED', remainingAmount: '0', recoveredAmount: '300' });
    });

    it('either approval stage can reject; the requester can cancel their own still-pending request', async () => {
      const r1 = await http().post('/api/v1/advances').set(as(mgrE)).send({ employeeId: empId, amount: '150', reason: 'to be rejected' });
      expect((await http().post(`/api/v1/advances/${r1.body.data.id}/reject`).set(as(mgrE)).send({})).body.error.code).toBe('REASON_REQUIRED');
      await http().post(`/api/v1/advances/${r1.body.data.id}/reject`).set(as(mgrE)).send({ reason: 'Not eligible' }).expect(200);
      expect((await http().get(`/api/v1/advances/${r1.body.data.id}`).set(as(owner))).body.data).toMatchObject({ status: 'REJECTED', rejectionReason: 'Not eligible' });

      const r2 = await http().post('/api/v1/advances').set(as(mgrE)).send({ employeeId: empId, amount: '150', reason: 'to be cancelled' });
      expect((await http().post(`/api/v1/advances/${r2.body.data.id}/cancel`).set(as(accountant)).send({})).status).toBe(403); // not who requested it
      await http().post(`/api/v1/advances/${r2.body.data.id}/cancel`).set(as(mgrE)).send({}).expect(200);
      expect((await http().get(`/api/v1/advances/${r2.body.data.id}`).set(as(owner))).body.data.status).toBe('CANCELLED');
    });
  });

  // ------------------------------------------------------------------ management P&L
  describe('management P&L', () => {
    let ploc: string;
    let rentCat: string;
    let rawCat: string;
    const month = today.slice(0, 7);

    beforeAll(async () => {
      ploc = (await http().post('/api/v1/locations').set(as(owner)).send({ code: `PL${rnd}`, name: `PL Test ${rnd}`, type: 'BRANCH', defaultOpeningCash: '500.00' })).body.data.id;
      const cats = (await http().get('/api/v1/expense-categories').set(as(owner))).body.data as any[];
      rentCat = cats.find((c) => c.plBucket === 'RENT' && !c.parentId).id;
      rawCat = cats.find((c) => c.plBucket === 'RAW_MATERIAL' && !c.parentId).id;

      await http().put(`/api/v1/daily-sales?locationId=${ploc}&date=${today}`).set(as(owner)).send({ totalSales: '5000.00', cashSales: '5000.00' }).expect(200);
      await http().post('/api/v1/expenses').set(as(owner)).send({ locationId: ploc, businessDate: today, categoryId: rentCat, amount: '500.00', paymentMode: 'CASH' }).expect(201);
      // a raw-material expense logged by hand (not through Purchases) must not be lost, but also must not double-count against the consumption-based raw material line
      await http().post('/api/v1/expenses').set(as(owner)).send({ locationId: ploc, businessDate: today, categoryId: rawCat, amount: '50.00', paymentMode: 'CASH' }).expect(201);

      const supplierId = (await http().post('/api/v1/suppliers').set(as(owner)).send({ name: `PL Supplier ${rnd}` })).body.data.id;
      const boot = (await http().get('/api/v1/sync/bootstrap').set(as(owner))).body.data;
      const uMl = boot.units.find((u: any) => u.code === 'ML').id;
      const uL = boot.units.find((u: any) => u.code === 'L').id;
      const itemId = (await http().post('/api/v1/items').set(as(owner)).send({ nameEn: `PL Item ${rnd}`, category: 'RAW_MATERIAL', baseUnitId: uMl, purchaseUnitId: uL })).body.data.id;
      await http().post('/api/v1/purchases').set(as(owner)).send({
        locationId: ploc, businessDate: today, paymentMode: 'CASH', supplierId, items: [{ itemId, unitId: uL, quantity: '10', rate: '20' }],
      }).expect(201); // 10 L @ 20/L = 10000 ml @ 0.02/ml
      await http().put('/api/v1/stock/consumption').set(as(owner)).send({ locationId: ploc, businessDate: today, items: [{ itemId, quantity: '1000' }] }).expect(200); // 1000 ml used @ 0.02 = 20

      await http().post('/api/v1/wastage').set(as(owner)).send({ locationId: ploc, businessDate: today, itemId, quantity: '50', unitId: uMl, reason: 'SPOILED' }).expect(201); // 50 ml @ 0.02 = 1

      const empId = (await http().post('/api/v1/employees').set(as(owner)).send({
        fullName: `PL Employee ${rnd}`, locationId: ploc, jobRole: 'Staff', joiningDate: addDaysStr(today, -30), salaryType: 'DAILY', baseSalary: '200',
      })).body.data.id;
      await http().put('/api/v1/attendance').set(as(owner)).send({ locationId: ploc, businessDate: today, items: [{ employeeId: empId, status: 'PRESENT' }] }).expect(200);
      await http().post('/api/v1/salary/compute').set(as(owner)).send({ employeeId: empId, month }).expect(201); // payable 200 (1 present day x 200/day)
    });

    it('branch P&L: sales - raw material (actual consumption) - salary (payroll) - rent - other (folded manual entries) - wastage = operating profit', async () => {
      expect((await http().get(`/api/v1/pl/branch?locationId=${ploc}&from=${today}&to=${today}`).set(as(manager))).status).toBe(403);
      const res = await http().get(`/api/v1/pl/branch?locationId=${ploc}&from=${today}&to=${today}`).set(as(owner));
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        label: 'MANAGEMENT P&L', totalSales: '5000', rawMaterial: '20', salary: '200', rent: '500', electricity: '0', transport: '0', maintenance: '0',
        otherExpenses: '50', wastage: '1', salesDays: 1, avgDailySales: '5000',
      });
      // 5000 - 20 - 200 - 500 - 0 - 0 - 0 - 50 - 1 = 4229
      expect(res.body.data.operatingProfit).toBe('4229');
      expect(res.body.data.marginPct).toBe('84.6');
    });

    it('consolidated P&L: every branch rolled into one total, for an owner-chosen date range', async () => {
      const res = await http().get(`/api/v1/pl/consolidated?from=${today}&to=${today}`).set(as(owner));
      expect(res.status).toBe(200);
      expect(res.body.data.label).toBe('CONSOLIDATED BUSINESS P&L');
      expect(res.body.data.branchCount).toBeGreaterThan(0);
      // this branch's own contributions must be included in the roll-up
      expect(Number(res.body.data.totalSales)).toBeGreaterThanOrEqual(5000);
      expect(Number(res.body.data.rawMaterial)).toBeGreaterThanOrEqual(20);
      expect((await http().get(`/api/v1/pl/consolidated?from=${today}&to=${today}`).set(as(manager))).status).toBe(403);
    });
  });

  describe('settings admin: units, roles & permissions, approval limits', () => {
    it('units: create a base unit and a derived unit, then edit the derived unit\'s name and factor without touching history', async () => {
      const baseCode = `BU${rnd}`;
      const base = await http().post('/api/v1/units').set(as(owner)).send({ code: baseCode, name: 'Test base unit' });
      expect(base.status).toBe(201);
      expect(base.body.data.factorToBase).toBe('1');

      const derivedCode = `DU${rnd}`;
      const derived = await http().post('/api/v1/units').set(as(owner)).send({ code: derivedCode, name: 'Test derived unit', baseUnitId: base.body.data.id, factorToBase: '12' });
      expect(derived.status).toBe(201);
      expect(derived.body.data.factorToBase).toBe('12');

      // duplicate code is rejected
      expect((await http().post('/api/v1/units').set(as(owner)).send({ code: baseCode, name: 'dup' })).status).toBe(409);
      // a base unit can never carry a conversion factor
      expect((await http().patch(`/api/v1/units/${base.body.data.id}`).set(as(owner)).send({ factorToBase: '5' })).status).toBe(422);
      // branch managers cannot manage units
      expect((await http().post('/api/v1/units').set(as(manager)).send({ code: `X${rnd}`, name: 'nope' })).status).toBe(403);

      const updated = await http().patch(`/api/v1/units/${derived.body.data.id}`).set(as(owner)).send({ name: 'Renamed unit', factorToBase: '24' });
      expect(updated.status).toBe(200);
      expect(updated.body.data).toMatchObject({ name: 'Renamed unit', factorToBase: '24' });
    });

    it('roles: create a custom role, assign permissions, and refuse to leave zero active roles holding role:manage', async () => {
      const list = await http().get('/api/v1/roles').set(as(owner));
      expect(list.status).toBe(200);
      const owner_role = list.body.data.find((r: any) => r.code === 'OWNER');
      expect(owner_role.permissions).toContain('role:manage');
      expect((await http().get('/api/v1/roles').set(as(manager))).status).toBe(403);

      const perms = await http().get('/api/v1/permissions').set(as(owner));
      expect(perms.status).toBe(200);
      expect(perms.body.data.some((p: any) => p.code === 'expense:view')).toBe(true);

      const code = `CUSTOM${rnd}`;
      const created = await http().post('/api/v1/roles').set(as(owner)).send({ code, name: 'Custom Role', scopeMode: 'ASSIGNED', permissionCodes: ['stock:view'] });
      expect(created.status).toBe(201);
      expect(created.body.data.permissions).toEqual(['stock:view']);

      const putPerms = await http().put(`/api/v1/roles/${created.body.data.id}/permissions`).set(as(owner)).send({ permissionCodes: ['stock:view', 'wastage:create'] });
      expect(putPerms.status).toBe(200);
      expect(putPerms.body.data.permissions.sort()).toEqual(['stock:view', 'wastage:create']);

      // only OWNER holds role:manage in this deployment; stripping it would lock everyone out of this screen
      const strip = await http().put(`/api/v1/roles/${owner_role.id}/permissions`).set(as(owner)).send({ permissionCodes: owner_role.permissions.filter((p: string) => p !== 'role:manage') });
      expect(strip.status).toBe(422);

      // a role with active users cannot be deactivated
      expect((await http().patch(`/api/v1/roles/${created.body.data.id}`).set(as(owner)).send({ status: 'INACTIVE' })).status).toBe(200); // no users assigned yet: allowed
    });

    it('approval limits: list includes the role code/name, and an owner can raise a role\'s limit for an entity type', async () => {
      const before = await http().get('/api/v1/approval-limits').set(as(owner));
      expect(before.status).toBe(200);
      const bm = before.body.data.find((l: any) => l.roleCode === 'BRANCH_MANAGER' && l.entityType === 'EXPENSE');
      expect(bm).toBeDefined();
      expect(bm.roleName).toBe('Branch Manager');

      const put = await http().put('/api/v1/approval-limits').set(as(owner)).send({ roleCode: 'BRANCH_MANAGER', entityType: 'EXPENSE', maxAmount: '750.00' });
      expect(put.status).toBe(200);
      const after = await http().get('/api/v1/approval-limits').set(as(owner));
      expect(after.body.data.find((l: any) => l.roleCode === 'BRANCH_MANAGER' && l.entityType === 'EXPENSE').maxAmount).toBe('750');

      expect((await http().put('/api/v1/approval-limits').set(as(manager)).send({ roleCode: 'BRANCH_MANAGER', entityType: 'EXPENSE', maxAmount: '1' })).status).toBe(403);
    });
  });
});
