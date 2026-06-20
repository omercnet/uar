import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { EvidenceArtifactSchema, ReviewAssignmentSchema, ReviewDecisionSchema } from '@uar/core';
import { z } from 'zod';

import { ReviewContentEdgeSchema, ReviewContentNodeSchema, canonicalJson } from '../content-hash.js';
import {
  EvidenceSinkWriteInputSchema,
  EvidenceSinkWriteResultSchema,
  type EvidenceSink,
  type EvidenceSinkWriteInput,
  type EvidenceSinkWriteResult,
} from './sink.js';

const CSV_EVIDENCE_CONTENT_TYPE = 'text/csv' as const;
const nonEmptyStringSchema = z.string().min(1);
const csvHeader = ['section', 'recordJson'] as const;

const CsvFileEvidenceSinkConfigSchema = z
  .object({
    outputDirectory: nonEmptyStringSchema,
  })
  .strict();
type CsvFileEvidenceSinkConfig = z.infer<typeof CsvFileEvidenceSinkConfigSchema>;

const FinalizedReviewContentSectionsSchema = z.tuple([
  z.array(ReviewContentNodeSchema).readonly(),
  z.array(ReviewContentEdgeSchema).readonly(),
  z.array(ReviewDecisionSchema).readonly(),
  z.array(ReviewAssignmentSchema).readonly(),
]);
type FinalizedReviewContentSections = z.infer<typeof FinalizedReviewContentSectionsSchema>;

type CsvEvidenceSection = 'node' | 'edge' | 'decision' | 'assignment';

export interface CsvFileEvidenceSinkConfigInput {
  readonly outputDirectory: string;
}

export class CsvFileEvidenceSinkError extends Error {
  override readonly name = 'CsvFileEvidenceSinkError';

  constructor(readonly reason: string, options?: ErrorOptions) {
    super(`Cannot write CSV evidence: ${reason}`, options);
  }
}

export class CsvFileEvidenceSink implements EvidenceSink {
  readonly sinkKind = 'csv-file' as const;
  private readonly config: CsvFileEvidenceSinkConfig;

  constructor(configInput: CsvFileEvidenceSinkConfigInput) {
    this.config = CsvFileEvidenceSinkConfigSchema.parse(configInput);
  }

  async write(input: EvidenceSinkWriteInput): Promise<EvidenceSinkWriteResult> {
    const parsedInput = EvidenceSinkWriteInputSchema.parse(input);
    const csvContent = renderCsvEvidence(parsedInput.finalizedExport.canonicalContent);
    const csvHash = createHash('sha256').update(csvContent).digest('hex');
    const outputDirectory = join(this.config.outputDirectory, parsedInput.tenantId, parsedInput.campaignId);
    const filePath = join(outputDirectory, `sha256-${parsedInput.finalizedExport.contentHash}.csv`);
    const storageUri = pathToFileURL(filePath).toString();

    await mkdir(outputDirectory, { recursive: true });
    await writeFile(filePath, csvContent, 'utf8');

    return EvidenceSinkWriteResultSchema.parse({
      artifact: EvidenceArtifactSchema.parse({
        tenantId: parsedInput.tenantId,
        evidenceArtifactId: `csv-file:sha256:${csvHash}`,
        contentHash: csvHash,
        contentType: CSV_EVIDENCE_CONTENT_TYPE,
        byteSize: Buffer.byteLength(csvContent, 'utf8'),
        immutable: true,
        createdAt: parsedInput.finalizedExport.artifact.createdAt,
        storageUri,
      }),
      storageUri,
    });
  }
}

export function createCsvFileEvidenceSink(configInput: CsvFileEvidenceSinkConfigInput): CsvFileEvidenceSink {
  return new CsvFileEvidenceSink(configInput);
}

export function renderCsvEvidence(canonicalContent: string): string {
  const [nodes, edges, decisions, assignments] = parseCanonicalReviewContent(canonicalContent);
  const rows = [
    csvHeader,
    ...nodes.map((record) => csvRecord('node', record)),
    ...edges.map((record) => csvRecord('edge', record)),
    ...decisions.map((record) => csvRecord('decision', record)),
    ...assignments.map((record) => csvRecord('assignment', record)),
  ];

  return `${rows.map(formatCsvRow).join('\n')}\n`;
}

function parseCanonicalReviewContent(canonicalContent: string): FinalizedReviewContentSections {
  const rawSections = canonicalContent.split('\n').map((line) => parseJsonLine(line));

  return FinalizedReviewContentSectionsSchema.parse(rawSections);
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new CsvFileEvidenceSinkError('canonical content contains invalid JSON', { cause: error });
    }

    throw error;
  }
}

function csvRecord(section: CsvEvidenceSection, record: unknown): readonly string[] {
  return [section, canonicalJson(record)];
}

function formatCsvRow(row: readonly string[]): string {
  return row.map(formatCsvCell).join(',');
}

function formatCsvCell(cell: string): string {
  if (!/[",\n\r]/.test(cell)) {
    return cell;
  }

  return `"${cell.replaceAll('"', '""')}"`;
}
