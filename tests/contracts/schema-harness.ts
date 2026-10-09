import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schemaRoot = resolve(import.meta.dirname, "../../schemas");

function readSchema(name: string): object {
  return JSON.parse(readFileSync(resolve(schemaRoot, name), "utf8")) as object;
}

export const schemaIds = {
  accounting: "https://mission-control.local/schemas/accounting_v2.snapshot.schema.json",
  submission: "https://mission-control.local/schemas/submission_tracker.snapshot.schema.json",
  bankJournal: "https://mission-control.local/schemas/bank_journal_quality.snapshot.schema.json",

} as const;

export function compileContractSchemas(): {
  readonly accounting: ValidateFunction;
  readonly submission: ValidateFunction;
  readonly bankJournal: ValidateFunction;

} {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(readSchema("common.snapshot.defs.schema.json"));
  ajv.addSchema(readSchema("accounting_v2.snapshot.schema.json"));
  ajv.addSchema(readSchema("submission_tracker.snapshot.schema.json"));
  ajv.addSchema(readSchema("bank_journal_quality.snapshot.schema.json"));


  return {
    accounting: ajv.getSchema(schemaIds.accounting)!,
    submission: ajv.getSchema(schemaIds.submission)!,
    bankJournal: ajv.getSchema(schemaIds.bankJournal)!,

  };
}
