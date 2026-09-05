import { Agent } from '@mastra/core/agent';
import type { TeamConfig } from '../config/team.js';
import { DEFAULT_TEAM } from '../config/team.js';
import { PUBG_CAPABILITIES } from '../config/capabilities.js';
import { CanonicalQuerySchema, type CanonicalQuery } from '../schema/query.js';
import { buildDeterministicQuery, isReviewIntent, type PlannerInput } from './deterministic-planner.js';

export interface PlannerOptions {
  team?: TeamConfig;
  model?: string;
}

export class MastraPubgPlanner {
  private readonly agent?: Agent;
  private readonly team: TeamConfig;

  constructor(options: PlannerOptions = {}) {
    this.team = options.team ?? DEFAULT_TEAM;
    const model = options.model ?? process.env.PUBG_PLANNER_MODEL ?? '';
    if (model.trim()) {
      this.agent = new Agent({
        id: 'pubg-planner-v3',
        name: 'PUBG Query Planner v3',
        instructions: 'You are a strict PUBG query planner. Output only the requested canonical query object. Never call data APIs, calculate statistics, or answer the user.',
        model: model as never,
      });
    }
  }

  async plan(input: PlannerInput): Promise<CanonicalQuery> {
    const fallback = buildDeterministicQuery(input, this.team);
    const fallbackAllowsReview = fallback.operation === 'review_match';
    // Review routing is an explicit product boundary. Do not let an optional
    // planner model turn a normal report or a review request into another op.
    if (isReviewIntent(input.text) || fallbackAllowsReview) return fallback;
    if (!this.agent) return fallback;
    const prompt = [
      '将用户问题转换成 Canonical PUBG Query。只输出结构化对象，不要回答问题。',
      `当前时间：${(input.now ?? new Date()).toISOString()}，时区：Asia/Shanghai，业务日开始：06:00。`,
      `默认小队：${JSON.stringify(this.team.players.map((player) => ({ id: player.id, name: player.name, aliases: player.aliases })))}`,
      `能力注册表：${JSON.stringify(PUBG_CAPABILITIES)}`,
      `结构化上下文提示：${JSON.stringify(input.context ?? {})}`,
      `用户问题：${input.text}`,
      '规则：没有显式时间时不要自行计算时间；使用 relative_period；strongest/weakest/rank/compare/trend 必须使用对应 operation；明确复盘/分析某一局才使用 review_match，并保留 matchSelector；weapon/telemetry 必须标记 unsupportedCapability。',
    ].join('\n');
    try {
      const output = await this.agent.generate(prompt, {
        structuredOutput: { schema: CanonicalQuerySchema },
        maxSteps: 1,
      });
      const candidate = (output as unknown as { object?: unknown }).object;
      const parsed = CanonicalQuerySchema.safeParse(candidate);
      if (parsed.success) {
        // The optional model may not create a review branch for an ordinary
        // V3 report. The deterministic fallback owns this operation boundary.
        if (parsed.data.operation === 'review_match' && !fallbackAllowsReview) return fallback;
        return {
          ...parsed.data,
          queryId: input.queryId ?? parsed.data.queryId,
          reference: {
            ...fallback.reference,
            ...parsed.data.reference,
            planner: 'mastra_agent',
          },
        };
      }
    } catch {
      // A planner outage must fall back to a deterministic, validated plan.
    }
    return fallback;
  }
}
