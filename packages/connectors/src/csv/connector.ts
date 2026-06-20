import {
  ConnectorRecordSchema,
  SyncResultSchema,
  contractVersion,
  type CapabilityDescriptor,
  type ConnectorRecord,
  type SyncResult,
} from '@uar/core';
import { z } from 'zod';

const nonEmptyStringSchema = z.string().min(1);
const csvSource = 'manual-csv' as const;

const CsvConnectorConfigSchema = z.object({
  tenantId: nonEmptyStringSchema,
  applicationId: nonEmptyStringSchema,
  csvContent: nonEmptyStringSchema,
  observedAt: z.iso.datetime().optional(),
  pageSize: z.number().int().positive().default(100),
});

const CsvSyncInputSchema = z.object({
  cursor: z.string().regex(/^\d+$/).nullable(),
});

const CsvAccessRowSchema = z.object({
  externalAccountId: nonEmptyStringSchema,
  email: z.email(),
  displayName: nonEmptyStringSchema.optional(),
  grantId: nonEmptyStringSchema,
  accessId: nonEmptyStringSchema,
  accessLabel: nonEmptyStringSchema,
  accessType: nonEmptyStringSchema.default('role'),
  observedAt: z.iso.datetime().optional(),
});

const requiredColumns = [
  'externalAccountId',
  'email',
  'grantId',
  'accessId',
  'accessLabel',
] as const;

type CsvConnectorConfig = z.infer<typeof CsvConnectorConfigSchema>;
type CsvAccessRow = z.infer<typeof CsvAccessRowSchema>;

export interface CsvConnectorConfigInput {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly csvContent: string;
  readonly observedAt?: string;
  readonly pageSize?: number;
}

export interface CsvSyncInput {
  readonly cursor: string | null;
}

export interface CsvConnector {
  readonly descriptor: CapabilityDescriptor;
  sync(input: CsvSyncInput): AsyncIterable<SyncResult>;
}

export class CsvConnectorInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvConnectorInputError';
  }
}

export const MANUAL_CSV_CONNECTOR_ID = 'manual-csv' as const;

export const MANUAL_CSV_DESCRIPTOR = {
  contractVersion,
  connectorId: MANUAL_CSV_CONNECTOR_ID,
  capabilities: {
    users: true,
    groups: false,
    roles: true,
    permissions: false,
    access_grants: true,
    owners: false,
    revoke: false,
    evidence_links: false,
  },
} satisfies CapabilityDescriptor;

export function createCsvConnector(configInput: CsvConnectorConfigInput): CsvConnector {
  const config = CsvConnectorConfigSchema.parse(configInput);

  return {
    descriptor: MANUAL_CSV_DESCRIPTOR,
    sync: async function* sync({ cursor }) {
      const parsedInput = CsvSyncInputSchema.parse({ cursor });
      const rows = parseCsvAccessRows(config.csvContent);
      const startIndex = parsedInput.cursor === null ? 0 : Number(parsedInput.cursor);

      for (let index = startIndex; index < rows.length; index += config.pageSize) {
        const pageRows = rows.slice(index, index + config.pageSize);
        const nextIndex = index + pageRows.length;
        const nextCursor = nextIndex < rows.length ? String(nextIndex) : null;
        const result = {
          cursor: nextCursor,
          records: pageRows.map((row) => toConnectorRecord(config, row)),
        } satisfies SyncResult;

        yield SyncResultSchema.parse(result);
      }
    },
  };
}

function parseCsvAccessRows(csvContent: string): readonly CsvAccessRow[] {
  const lines = csvContent.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headerLine = lines[0];

  if (headerLine === undefined) {
    throw new CsvConnectorInputError('CSV content must include a header row');
  }

  const headers = parseCsvLine(headerLine).map((header) => header.trim());
  assertRequiredHeaders(headers);

  return lines.slice(1).map((line, lineIndex) => parseAccessRow(headers, line, lineIndex + 2));
}

function parseAccessRow(
  headers: readonly string[],
  line: string,
  lineNumber: number,
): CsvAccessRow {
  const values = parseCsvLine(line);

  if (values.length !== headers.length) {
    throw new CsvConnectorInputError(`CSV line ${lineNumber} has ${values.length} values for ${headers.length} headers`);
  }

  const row: Record<string, string> = {};

  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index];
    const value = values[index];

    if (header === undefined || value === undefined) {
      throw new CsvConnectorInputError(`CSV line ${lineNumber} has an incomplete column`);
    }

    row[header] = value.trim();
  }

  const parsed = CsvAccessRowSchema.safeParse(row);

  if (!parsed.success) {
    throw new CsvConnectorInputError(`CSV line ${lineNumber} failed validation: ${parsed.error.message}`);
  }

  return parsed.data;
}

function assertRequiredHeaders(headers: readonly string[]): void {
  const missingColumns = requiredColumns.filter((column) => !headers.includes(column));

  if (missingColumns.length > 0) {
    throw new CsvConnectorInputError(`CSV header missing required columns: ${missingColumns.join(', ')}`);
  }
}

function parseCsvLine(line: string): readonly string[] {
  const cells: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (character === ',' && !inQuotes) {
      cells.push(currentCell);
      currentCell = '';
    } else {
      currentCell += character;
    }
  }

  if (inQuotes) {
    throw new CsvConnectorInputError('CSV line has an unclosed quoted field');
  }

  cells.push(currentCell);

  return cells;
}

function toConnectorRecord(config: CsvConnectorConfig, row: CsvAccessRow): ConnectorRecord {
  const record = {
    tenantId: config.tenantId,
    applicationId: config.applicationId,
    externalAccountId: row.externalAccountId,
    recordType: 'access_grant',
    payload: {
      externalAccountId: row.externalAccountId,
      email: row.email,
      displayName: row.displayName ?? row.email,
      grantId: row.grantId,
      accessType: row.accessType,
      accessId: row.accessId,
      accessLabel: row.accessLabel,
      source: csvSource,
    },
    observedAt: row.observedAt ?? config.observedAt ?? new Date().toISOString(),
  } satisfies ConnectorRecord;

  return ConnectorRecordSchema.parse(record);
}
