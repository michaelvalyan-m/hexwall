// Zod response schemas (ARCHITECTURE §5). Used to validate the API surface in integration tests
// and to document the wire shapes. Read-only data only.

import { z } from 'zod';

export const SeveritySchema = z.enum(['ok', 'warn', 'crit', 'gone']);

export const PodViewSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  workload: z.string(),
  node: z.string(),
  phase: z.string(),
  state: SeveritySchema,
  reason: z.string().optional(),
  message: z.string().optional(),
  restarts: z.number(),
  exitCode: z.number().optional(),
  startedAt: z.string().optional(),
});

export const NodeResourceSchema = z.object({
  usagePct: z.number(),
  requestPct: z.number().optional(),
  pressure: z.boolean().optional(),
});

export const NodeViewSchema = z.object({
  name: z.string(),
  instanceType: z.string().optional(),
  ready: z.boolean(),
  conditions: z.record(z.boolean()),
  cpu: NodeResourceSchema,
  mem: NodeResourceSchema,
  disk: NodeResourceSchema,
  net: z.object({ ready: z.boolean(), lossPct: z.number().optional() }),
  health: SeveritySchema,
  stateAgeMs: z.number().optional(),
  pods: z.array(PodViewSchema),
});

export const QuartileBoxSchema = z.object({
  kind: z.enum(['node', 'workload']),
  id: z.string(),
  label: z.string(),
  nodeHealth: SeveritySchema,
  podTotal: z.number(),
  affected: z.number(),
  affectedPct: z.number(),
  litHexes: z.number().min(0).max(4),
  litSeverity: SeveritySchema,
  hexes: z.array(SeveritySchema).length(4),
  chip: z.string(),
  foldEligible: z.boolean(),
  changedAt: z.number(),
});

export const ClusterSnapshotSchema = z.object({
  cluster: z.string(),
  generatedAt: z.number(),
  boxes: z.array(QuartileBoxSchema),
  healthyFolded: z.number(),
  totals: z.object({
    nodes: z.number(),
    pods: z.number(),
    nodesCrit: z.number(),
    nodesWarn: z.number(),
  }),
});

export const LogSpanSchema = z.object({
  text: z.string(),
  kind: z.enum(['plain', 'warn', 'crit']),
});
export const LogLineSchema = z.object({
  raw: z.string(),
  spans: z.array(LogSpanSchema),
});

export const PodDetailSchema = z.object({
  pod: PodViewSchema,
  crash: z
    .object({
      reason: z.string(),
      exitReason: z.string().optional(),
      exitCode: z.number().optional(),
      message: z.string().optional(),
      previousLogs: z.array(LogLineSchema),
    })
    .optional(),
  events: z.array(
    z.object({ type: z.string(), reason: z.string(), message: z.string(), at: z.string() }),
  ),
  logs: z.array(LogLineSchema),
});

export const HealthyNodesSchema = z.object({ nodes: z.array(NodeViewSchema) });
