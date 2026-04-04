import {
  eq,
  and,
  desc,
  sql,
  skills,
  skillExecutions,
  type Database,
} from "@haggle/db";

type SkillCategory = "STRATEGY" | "DATA" | "INTERPRETATION" | "AUTHENTICATION" | "DISPUTE_RESOLUTION";
type SkillProvider = "FIRST_PARTY" | "THIRD_PARTY" | "COMMUNITY";
type SkillStatus = "DRAFT" | "ACTIVE" | "SUSPENDED" | "DEPRECATED";

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export async function getSkillBySkillId(db: Database, skillId: string) {
  const rows = await db
    .select()
    .from(skills)
    .where(eq(skills.skillId, skillId))
    .limit(1);

  return rows[0] ?? null;
}

export async function listSkills(
  db: Database,
  filters?: { category?: string; status?: string; hookPoint?: string },
) {
  const conditions = [];

  if (filters?.category) {
    conditions.push(eq(skills.category, filters.category as SkillCategory));
  }
  if (filters?.status) {
    conditions.push(eq(skills.status, filters.status as SkillStatus));
  }

  const rows = await db
    .select()
    .from(skills)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  // Post-filter by hookPoint (stored as jsonb array)
  if (filters?.hookPoint) {
    return rows.filter((r) => {
      const hooks = r.hookPoints as string[] | null;
      return hooks != null && hooks.includes(filters.hookPoint!);
    });
  }

  return rows;
}

export async function createSkill(
  db: Database,
  data: {
    skillId: string;
    name: string;
    description: string;
    version: string;
    category: SkillCategory;
    provider: SkillProvider;
    supportedCategories: string[];
    hookPoints: string[];
    pricing: Record<string, unknown>;
    configSchema?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
) {
  const [row] = await db
    .insert(skills)
    .values({
      skillId: data.skillId,
      name: data.name,
      description: data.description,
      version: data.version,
      category: data.category,
      provider: data.provider,
      supportedCategories: data.supportedCategories,
      hookPoints: data.hookPoints,
      pricing: data.pricing,
      configSchema: data.configSchema,
      metadata: data.metadata,
    })
    .returning();

  return row;
}

export async function updateSkillStatus(
  db: Database,
  skillId: string,
  status: SkillStatus,
) {
  const [row] = await db
    .update(skills)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(skills.skillId, skillId))
    .returning();

  return row ?? null;
}

export async function updateSkillMetrics(
  db: Database,
  skillId: string,
  latencyMs: number,
  success: boolean,
) {
  // Rolling average via SQL (per-statement atomic, not concurrent-safe — acceptable for MVP)
  const [row] = await db
    .update(skills)
    .set({
      usageCount: sql`${skills.usageCount} + 1`,
      averageLatencyMs: sql`(${skills.averageLatencyMs}::numeric * ${skills.usageCount} + ${latencyMs}) / (${skills.usageCount} + 1)`,
      errorRate: sql`(${skills.errorRate}::numeric * ${skills.usageCount} + ${success ? 0 : 1}) / (${skills.usageCount} + 1)`,
      updatedAt: new Date(),
    })
    .where(eq(skills.skillId, skillId))
    .returning();

  return row ?? null;
}

// ---------------------------------------------------------------------------
// Skill Executions
// ---------------------------------------------------------------------------

export async function recordExecution(
  db: Database,
  data: {
    skillId: string;
    hookPoint: string;
    success: boolean;
    latencyMs: number;
    inputSummary?: Record<string, unknown>;
    outputSummary?: Record<string, unknown>;
    error?: string;
  },
) {
  const [row] = await db
    .insert(skillExecutions)
    .values({
      skillId: data.skillId,
      hookPoint: data.hookPoint,
      success: data.success,
      latencyMs: data.latencyMs,
      inputSummary: data.inputSummary,
      outputSummary: data.outputSummary,
      error: data.error,
    })
    .returning();

  return row;
}

export async function getExecutionsBySkillId(
  db: Database,
  skillId: string,
  limit?: number,
) {
  const rows = await db
    .select()
    .from(skillExecutions)
    .where(eq(skillExecutions.skillId, skillId))
    .orderBy(desc(skillExecutions.createdAt))
    .limit(limit ?? 50);

  return rows;
}
