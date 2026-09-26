import { Injectable } from '@nestjs/common';
import { todayIST } from './dates';
import { Tx } from './prisma.service';

const KINDS = {
  expense: { seq: 'seq_code_expense', prefix: 'EXP', perLocation: true },
  purchase: { seq: 'seq_code_purchase', prefix: 'PUR', perLocation: true },
  transfer: { seq: 'seq_code_transfer', prefix: 'TRF', perLocation: false },
  wastage: { seq: 'seq_code_wastage', prefix: 'WST', perLocation: true },
  supplierPayment: { seq: 'seq_code_supplier_payment', prefix: 'SPY', perLocation: true },
  advance: { seq: 'seq_code_advance', prefix: 'ADV', perLocation: true },
  employee: { seq: 'seq_code_employee', prefix: 'EMP', perLocation: false },
} as const;

export type CodeKind = keyof typeof KINDS;

/** Human-readable document codes, e.g. EXP-BR002-26-000871 (LLD s1). Separate from primary keys. */
@Injectable()
export class CodesService {
  async next(tx: Tx, kind: CodeKind, locationId?: string): Promise<string> {
    const k = KINDS[kind];
    // sequence name comes from the constant table above, never from user input
    const rows = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT nextval('${k.seq}') AS n`);
    const n = String(rows[0].n).padStart(6, '0');
    const yy = todayIST().slice(2, 4);
    if (k.perLocation && locationId) {
      const loc = await tx.location.findUnique({ where: { id: locationId }, select: { code: true } });
      return `${k.prefix}-${loc?.code ?? 'NA'}-${yy}-${n}`;
    }
    return `${k.prefix}-${yy}-${n}`;
  }
}
