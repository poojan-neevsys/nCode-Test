import type { DatabaseSync } from 'node:sqlite';

// AB#comp-validation, criterion 4: salary is a whole number from 1 to 10000000.
const SALARY_MIN = 1;
const SALARY_MAX = 10000000;
// AB#comp-validation, criterion 4: bonus target is a number from 0 to 100 when given (fractions allowed).
const BONUS_MIN = 0;
const BONUS_MAX = 100;

export const CURRENCIES = ['USD', 'INR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export type CompensationField = 'baseSalary' | 'currency' | 'bonusTargetPercent';
export type CompensationErrors = Partial<Record<CompensationField, string>>;

export interface CompensationInput {
  baseSalary: number;
  currency: Currency;
  bonusTargetPercent: number | null;
}

export interface CompensationRecord {
  baseSalary: number;
  currency: Currency;
  bonusTargetPercent: number | null;
  updatedAt: string;
}

type Row = Record<string, unknown>;

function isWholeNumberIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isNumberIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

// AB#comp-validation, criterion 4: report every invalid field and save nothing when any is invalid.
// Messages never repeat the submitted values, so they are safe to show and to log.
export function validateCompensation(
  body: unknown,
): { input: CompensationInput } | { errors: CompensationErrors } {
  const source: Record<string, unknown> =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const { baseSalary, currency, bonusTargetPercent } = source;
  const errors: CompensationErrors = {};

  if (!isWholeNumberIn(baseSalary, SALARY_MIN, SALARY_MAX)) {
    errors.baseSalary = `Enter a whole number from ${SALARY_MIN} to ${SALARY_MAX}.`;
  }
  if (typeof currency !== 'string' || !(CURRENCIES as readonly string[]).includes(currency)) {
    errors.currency = `Choose one of: ${CURRENCIES.join(', ')}.`;
  }

  // The bonus target is optional: a missing or null value means none.
  let bonus: number | null = null;
  if (bonusTargetPercent !== undefined && bonusTargetPercent !== null) {
    if (isNumberIn(bonusTargetPercent, BONUS_MIN, BONUS_MAX)) {
      bonus = bonusTargetPercent;
    } else {
      errors.bonusTargetPercent = `Enter a number from ${BONUS_MIN} to ${BONUS_MAX}, or leave it empty.`;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }
  return {
    input: {
      baseSalary: baseSalary as number,
      currency: currency as Currency,
      bonusTargetPercent: bonus,
    },
  };
}

function toCompensationRecord(row: Row): CompensationRecord {
  return {
    baseSalary: Number(row.base_salary),
    currency: String(row.currency) as Currency,
    bonusTargetPercent: row.bonus_target_percent === null ? null : Number(row.bonus_target_percent),
    updatedAt: String(row.updated_at),
  };
}

export function readCompensation(db: DatabaseSync, newHireId: number): CompensationRecord | null {
  const row = db
    .prepare(
      `SELECT base_salary, currency, bonus_target_percent, updated_at
       FROM new_hire_compensation
       WHERE new_hire_id = ?`,
    )
    .get(newHireId);
  return row ? toCompensationRecord(row) : null;
}

// AB#comp-storage, criterion 1 and 5: creates the record or replaces the one the new hire already has.
export function saveCompensation(db: DatabaseSync, newHireId: number, input: CompensationInput): void {
  db.prepare(
    `INSERT INTO new_hire_compensation (new_hire_id, base_salary, currency, bonus_target_percent)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (new_hire_id) DO UPDATE SET
       base_salary = excluded.base_salary,
       currency = excluded.currency,
       bonus_target_percent = excluded.bonus_target_percent,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).run(newHireId, input.baseSalary, input.currency, input.bonusTargetPercent);
}
