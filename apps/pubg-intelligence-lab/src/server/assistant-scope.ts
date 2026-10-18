import { loadBattleTelemetry } from './match-views.js';
import { safePlayerName, type Snapshot } from './snapshot.js';
import { type NormalizedMatch } from '@agent/pubg-domain';
import {
  battlePlayerRef,
  type BattleTelemetryDocument,
  buildResearchReport,
  reconstructBattleEpisodes,
  type ResearchAssistantEvidence,
  type ResearchAssistantToolset,
  type ResearchSquad,
} from '@agent/pubg-intelligence';
import { createHash } from 'node:crypto';

export interface ScopedPlayerAlias {
  accountId: string;
  name: string;
  alias: string;
}

export function requestedRecentMatchCount(question: string): number {
  const text = question.normalize('NFKC').toLocaleLowerCase('zh-CN');
  const match = /(?:近|最近|last)\s*(\d{1,2}|[零一二两三四五六七八九十]+)\s*(?:场|局|matches?)?/iu.exec(text);
  if (!match?.[1]) return 10;
  const token = match[1];
  const chinese: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const parsed = /^\d+$/u.test(token) ? Number(token) : chinese[token];
  return Math.max(1, Math.min(10, Number.isFinite(parsed) ? parsed! : 10));
}

export function requestedPlayerReview(question: string, players: readonly ScopedPlayerAlias[]): ScopedPlayerAlias | undefined {
  const text = question.normalize('NFKC').toLocaleLowerCase('zh-CN');
  if (!/(?:近\s*(?:[\d零一二两三四五六七八九十]+\s*)?(?:场|局)|最近.{0,8}(?:场|局|比赛)?|打法|复盘|分析|表现|状态|playstyle|performance|last\s+\d+)/iu.test(text)) return undefined;
  const candidates = players.filter((player) => player.name.trim() && text.includes(player.name.normalize('NFKC').toLocaleLowerCase('zh-CN')))
    .sort((left, right) => right.name.length - left.name.length);
  const longestNameLength = candidates[0]?.name.length;
  const best = candidates.filter((player) => player.name.length === longestNameLength);
  const accounts = new Set(best.map((player) => player.accountId));
  return accounts.size === 1 ? best[0] : undefined;
}

export interface AssistantEvidenceDetail extends ResearchAssistantEvidence {
  matchRef: string;
  occurredAt: string | null;
  detail: string;
  actor: string | null;
  victim: string | null;
  damage: number | null;
}

export interface ScopedAssistantContext {
  tools: ResearchAssistantToolset;
  evidenceByAlias: Map<string, ResearchAssistantEvidence>;
  labels: Record<string, string>;
}

export function createScopedAssistantContext(input: {
  snapshot: Snapshot;
  matches: readonly NormalizedMatch[];
  squad: ResearchSquad;
  telemetryMatchIds: ReadonlySet<string>;
  requestedMatchLimit?: number;
}): ScopedAssistantContext {
  const { snapshot, matches, squad } = input;
  const memberIds = new Set(squad.memberIds.length
    ? squad.memberIds
    : matches.flatMap((match) => match.players.map((player) => player.accountId)));
  const accountAliases = new Map<string, string>();
  const labels: Record<string, string> = {};
  const nameAliases: Array<{ name: string; alias: string }> = [];
  for (const [index, accountId] of [...memberIds].sort().entries()) {
    const alias = `PLAYER_${String(index + 1).padStart(2, '0')}`;
    accountAliases.set(accountId, alias);
    const player = matches.flatMap((match) => match.players).find((candidate) => candidate.accountId === accountId);
    const name = player ? safePlayerName(player.displayName || player.playerName, index) : `队员 ${index + 1}`;
    labels[alias] = name;
    nameAliases.push({ name, alias });
  }
  const metricAliases = new Map([...memberIds].map((accountId) => [createHash('sha256').update(accountId).digest('hex').slice(0, 12), accountAliases.get(accountId)!]));
  const sortedMatches = [...matches].sort((left, right) => right.timestamp - left.timestamp || right.matchId.localeCompare(left.matchId));
  const matchAliases = new Map(sortedMatches.map((match, index) => [match.matchId, `M${String(index + 1).padStart(4, '0')}`]));
  const matchesByAlias = new Map(sortedMatches.map((match) => [matchAliases.get(match.matchId)!, match]));
  const evidenceByAlias = new Map<string, ResearchAssistantEvidence>();
  const evidenceDetails = new Map<string, AssistantEvidenceDetail>();
  const sourceAliases = new Map<string, string>();
  let nextEvidenceNumber = 1;

  const addEvidence = (inputEvidence: Omit<AssistantEvidenceDetail, 'ref'>): string => {
    const sourceKey = `${inputEvidence.matchId}\u001f${inputEvidence.eventId ?? ''}\u001f${inputEvidence.kind}`;
    const existing = sourceAliases.get(sourceKey);
    if (existing) return existing;
    const ref = `E${String(nextEvidenceNumber++).padStart(4, '0')}`;
    const detail = { ...inputEvidence, ref };
    sourceAliases.set(sourceKey, ref);
    evidenceByAlias.set(ref, { ref, matchId: detail.matchId, eventId: detail.eventId, timeSeconds: detail.timeSeconds, kind: detail.kind });
    evidenceDetails.set(ref, detail);
    return ref;
  };

  const metricReport = (metric: 'damage' | 'kills' | 'knocks' | 'revives' | 'wins' | 'top10' | 'matches' | 'survival_time', groupBy: 'week' | 'map' | 'player' | 'none') => {
    const intent = {
      action: groupBy === 'week' ? 'trend' : groupBy === 'map' ? 'map_breakdown' : groupBy === 'player' ? 'player_comparison' : 'summary',
      metric,
      groupBy: groupBy === 'none' ? null : groupBy,
    } as const;
    const report = buildResearchReport({ matches, squad, intent, telemetryMatchIds: input.telemetryMatchIds });
    const evidenceRefs = report.evidence.map((evidence) => addEvidence({
      matchId: evidence.matchId,
      eventId: null,
      timeSeconds: null,
      kind: `match-store:${evidence.field}`,
      matchRef: matchAliases.get(evidence.matchId) ?? 'M0000',
      occurredAt: evidence.occurredAt,
      detail: `${evidence.mapName} · ${evidence.occurredAt ?? '时间未知'} · ${evidence.value} · ${evidence.description}`,
      actor: null,
      victim: null,
      damage: null,
    }));
    const playerRecentMatches = input.requestedMatchLimit === undefined ? undefined : [...matches]
      .sort((left, right) => right.timestamp - left.timestamp || right.matchId.localeCompare(left.matchId))
      .slice(0, input.requestedMatchLimit)
      .flatMap((match) => {
        const player = match.players.find((candidate) => memberIds.has(candidate.accountId));
        if (!player) return [];
        const playerAlias = accountAliases.get(player.accountId) ?? 'PLAYER_UNKNOWN';
        const ref = addEvidence({
          matchId: match.matchId,
          eventId: null,
          timeSeconds: null,
          kind: 'match-store:player-performance',
          matchRef: matchAliases.get(match.matchId) ?? 'M0000',
          occurredAt: match.createdAt ?? new Date(match.timestamp).toISOString(),
          detail: `${match.mapName} · ${match.createdAt ?? '时间未知'} · ${playerAlias} · ${player.kills} 杀 · ${player.damage} 伤害 · ${player.dbnos} 击倒 · ${player.revives} 救援 · 生存 ${player.survivalTime} 秒 · 排名 ${player.rank ?? '未知'}`,
          actor: playerAlias,
          victim: null,
          damage: player.damage,
        });
        return [{
          matchRef: matchAliases.get(match.matchId) ?? 'M0000',
          date: match.createdAt ?? new Date(match.timestamp).toISOString(),
          map: match.mapName,
          rank: player.rank,
          kills: player.kills,
          damage: player.damage,
          knocks: player.dbnos,
          revives: player.revives,
          survivalSeconds: player.survivalTime,
          evidenceRefs: [ref],
        }];
      });
    const players = report.players.map((player) => ({
      member: metricAliases.get(player.id) ?? 'PLAYER_UNKNOWN',
      matches: player.matches,
      kills: player.kills,
      damage: player.damage,
      knocks: player.knocks,
      revives: player.revives,
      averageDamage: player.averageDamage,
      wins: player.wins,
    }));
    const breakdown = report.breakdown.map((item) => ({
      label: groupBy === 'player' ? nameAliases.find((label) => label.name === item.label)?.alias ?? 'PLAYER_UNKNOWN' : item.label,
      matches: item.matches,
      rankedMatches: item.rankedMatches,
      total: item.total,
      average: item.average,
      wins: item.wins,
      top10: item.top10,
    }));
    return {
      status: report.status,
      metric,
      groupBy,
      selectedMatches: report.scope.selectedMatches,
      requestedMatches: input.requestedMatchLimit ?? report.scope.selectedMatches,
      summary: report.summary,
      telemetry: report.telemetry,
      players,
      breakdown,
      ...(playerRecentMatches ? { playerRecentMatches } : {}),
      evidenceRefs: [...new Set([...(playerRecentMatches?.flatMap((item) => item.evidenceRefs) ?? []), ...evidenceRefs])],
    };
  };

  const playerRef = (accountId: string | null): string | null => accountId ? accountAliases.get(accountId) ?? 'OPPONENT' : null;
  const tools: ResearchAssistantToolset = {
    searchMatches: ({ mapName, limit }) => {
      const filtered = sortedMatches.filter((match) => !mapName || match.mapName.toLocaleLowerCase('zh-CN').includes(mapName.toLocaleLowerCase('zh-CN'))).slice(0, limit);
      const rows = filtered.map((match) => {
        const matchRef = matchAliases.get(match.matchId)!;
        const ref = addEvidence({
          matchId: match.matchId,
          eventId: null,
          timeSeconds: null,
          kind: 'match-store:match-search',
          matchRef,
          occurredAt: match.createdAt ?? new Date(match.timestamp).toISOString(),
          detail: `${match.mapName} · ${match.gameMode} · ${match.players.filter((player) => memberIds.has(player.accountId)).reduce((sum, player) => sum + player.kills, 0)} kills`,
          actor: null,
          victim: null,
          damage: null,
        });
        const squadPlayers = match.players.filter((player) => memberIds.has(player.accountId));
        const placements = [...new Set(squadPlayers.map((player) => player.rank).filter((rank): rank is number => rank !== null && rank > 0))];
        return {
          matchRef,
          date: match.createdAt ?? new Date(match.timestamp).toISOString(),
          mapName: match.mapName || '未知地图',
          mode: match.gameMode,
          placement: placements.length === 1 ? placements[0] : null,
          kills: squadPlayers.reduce((sum, player) => sum + player.kills, 0),
          damage: squadPlayers.reduce((sum, player) => sum + player.damage, 0),
          telemetry: input.telemetryMatchIds.has(match.matchId) ? 'cached' : 'missing',
          evidenceRefs: [ref],
        };
      });
      return { status: rows.length ? 'available' : 'empty', count: rows.length, matches: rows };
    },
    getScopedMetrics: ({ metric, groupBy }) => metricReport(metric, groupBy),
    compareRescues: async ({ limit }) => {
      const telemetryMatches = sortedMatches.filter((match) => snapshot.telemetryUrls.has(match.matchId)).slice(0, 30);
      const revives = new Map<string, { actorId: string; victimId: string; events: Array<{ match: NormalizedMatch; event: BattleTelemetryDocument['events'][number] }> }>();
      let cursor = 0;
      let unavailableMatches = 0;
      await Promise.all(Array.from({ length: Math.min(3, telemetryMatches.length) }, async () => {
        while (cursor < telemetryMatches.length) {
          const match = telemetryMatches[cursor++]!;
          try {
            const telemetry = await loadBattleTelemetry(snapshot, match);
            for (const event of telemetry.events) {
              if (event.type !== 'REVIVE' || event.phase !== 'in_match' || !event.actorId || !event.victimId
                || !memberIds.has(event.actorId) || !memberIds.has(event.victimId)
                || !event.actorTeamId || event.actorTeamId !== event.victimTeamId) continue;
              const key = `${event.actorId}\u001f${event.victimId}`;
              const row = revives.get(key) ?? { actorId: event.actorId, victimId: event.victimId, events: [] };
              row.events.push({ match, event });
              revives.set(key, row);
            }
          } catch {
            unavailableMatches += 1;
          }
        }
      }));
      const pairs = [...revives.values()].sort((left, right) => right.events.length - left.events.length
        || (accountAliases.get(left.actorId) ?? '').localeCompare(accountAliases.get(right.actorId) ?? '')
        || (accountAliases.get(left.victimId) ?? '').localeCompare(accountAliases.get(right.victimId) ?? ''))
        .slice(0, limit).map((row) => {
          const refs = row.events.slice(0, 8).map(({ match, event }) => addEvidence({
            matchId: match.matchId,
            eventId: event.sourceEventId,
            timeSeconds: event.timeSeconds,
            kind: 'directed-revive',
            matchRef: matchAliases.get(match.matchId) ?? 'M0000',
            occurredAt: match.createdAt ?? new Date(match.timestamp).toISOString(),
            detail: `${match.mapName} · ${event.timeSeconds === null ? '时间未知' : `${Math.floor(event.timeSeconds / 60)}:${String(Math.floor(event.timeSeconds % 60)).padStart(2, '0')}`} · ${playerRef(event.actorId)} → ${playerRef(event.victimId)} REVIVE`,
            actor: playerRef(event.actorId),
            victim: playerRef(event.victimId),
            damage: null,
          }));
          return { actor: playerRef(row.actorId), victim: playerRef(row.victimId), count: row.events.length, evidenceRefs: refs };
        });
      return {
        status: pairs.length ? 'available' : 'insufficient_data',
        requestedMatches: telemetryMatches.length,
        analyzedMatches: telemetryMatches.length - unavailableMatches,
        unavailableMatches,
        denominator: 'selected-squad same-team directed REVIVE pairs in available telemetry',
        pairs,
        evidenceRefs: pairs.flatMap((pair) => pair.evidenceRefs),
      };
    },
    getMatchEpisodes: async ({ matchRef }) => {
      const match = matchesByAlias.get(matchRef);
      if (!match) return { status: 'outside_scope', matchRef };
      const telemetry = await loadBattleTelemetry(snapshot, match);
      const trackedPlayerIds = match.players.filter((player) => memberIds.has(player.accountId)).map((player) => player.accountId);
      const reconstruction = reconstructBattleEpisodes({ match, telemetry, trackedPlayerIds });
      const eventsById = new Map(telemetry.events.map((event) => [event.sourceEventId, event]));
      const opponentIds = [...new Set(telemetry.events.flatMap((event) => [event.actorId, event.victimId]).filter((id): id is string => Boolean(id) && !memberIds.has(id!)))].sort();
      const opponentAliases = new Map(opponentIds.map((id, index) => [id, `OPPONENT_${String(index + 1).padStart(2, '0')}`]));
      const safePlayer = (id: string | null) => id ? accountAliases.get(id) ?? opponentAliases.get(id) ?? 'OPPONENT_UNKNOWN' : null;
      const facts = snapshot.features.get(match.matchId)?.facts;
      const featureEvidenceRefs = (evidenceIds: readonly string[], kind: string, actorId: string | null): string[] => {
        const evidenceById = new Map((facts?.evidence ?? []).map((evidence) => [evidence.id, evidence]));
        return [...new Set(evidenceIds.flatMap((id) => {
          const evidence = evidenceById.get(id);
          if (!evidence) return [];
          return [addEvidence({
            matchId: match.matchId,
            eventId: evidence.eventIds[0] ?? null,
            timeSeconds: null,
            kind: `telemetry-feature:${kind}`,
            matchRef,
            occurredAt: match.createdAt ?? new Date(match.timestamp).toISOString(),
            detail: `${match.mapName} · ${evidence.description}`,
            actor: actorId ? safePlayer(actorId) : null,
            victim: null,
            damage: null,
          })];
        }))].slice(0, 8);
      };
      const combatFeatures = facts ? {
        weapons: facts.weapons.filter((item) => memberIds.has(item.playerId)).slice(0, 12).map((item) => ({
          player: safePlayer(item.playerId), weapon: item.weapon, shots: item.shots, hits: item.hits, damage: item.damage,
          knocks: item.knocks, kills: item.kills, evidenceRefs: featureEvidenceRefs(item.evidenceIds, 'weapon', item.playerId),
        })),
        fights: facts.fights.filter((item) => item.participants.some((id) => memberIds.has(id))).slice(0, 12).map((item) => ({
          participants: item.participants.map(safePlayer), result: item.result, damage: item.damage, knocks: item.knocks, kills: item.kills,
          evidenceRefs: featureEvidenceRefs(item.evidenceIds, 'fight', item.participants.find((id) => memberIds.has(id)) ?? null),
        })),
      } : null;
      const trackedBattleRefs = new Set(match.players.filter((player) => memberIds.has(player.accountId)).map((player) => battlePlayerRef(match.matchId, player.accountId)));
      const battleSummaries = reconstruction.battles.filter((battle) => battle.timeline.some((event) => trackedBattleRefs.has(event.actorRef ?? '') || trackedBattleRefs.has(event.victimRef ?? '')))
        .slice(0, 12).map((battle) => {
          const firstKnock = battle.postKnockResponse.firstKnockEventId ? eventsById.get(battle.postKnockResponse.firstKnockEventId) : undefined;
          const response = battle.postKnockResponse.responseEventId ? eventsById.get(battle.postKnockResponse.responseEventId) : undefined;
          const eventRef = (event: typeof firstKnock) => event ? addEvidence({
            matchId: match.matchId,
            eventId: event.sourceEventId,
            timeSeconds: event.timeSeconds,
            kind: `battle:${event.type.toLocaleLowerCase('en-US')}`,
            matchRef,
            occurredAt: match.createdAt ?? new Date(match.timestamp).toISOString(),
            detail: `${match.mapName} · ${event.type} · ${event.timeSeconds === null ? '时间未知' : `${Math.floor(event.timeSeconds / 60)}:${String(Math.floor(event.timeSeconds % 60)).padStart(2, '0')}`} · ${safePlayer(event.actorId) ?? '未知'}${event.victimId ? ` → ${safePlayer(event.victimId)}` : ''}${event.weaponId ? ` · ${event.weaponId}` : ''}${event.type === 'DAMAGE' ? ` · ${event.damage} 伤害` : ''}`,
            actor: safePlayer(event.actorId),
            victim: safePlayer(event.victimId),
            damage: event.type === 'DAMAGE' ? event.damage : null,
          }) : null;
          return {
            startSeconds: battle.startSeconds,
            endSeconds: battle.endSeconds,
            firstKnock: firstKnock ? { actor: safePlayer(firstKnock.actorId), victim: safePlayer(firstKnock.victimId), weapon: firstKnock.weaponId } : null,
            response: { status: battle.postKnockResponse.status, elapsedSeconds: battle.postKnockResponse.elapsedSeconds },
            responseEvent: response ? { type: response.type, actor: safePlayer(response.actorId), victim: safePlayer(response.victimId) } : null,
            evidenceRefs: [...new Set([eventRef(firstKnock), eventRef(response)].filter((ref): ref is string => Boolean(ref)))],
          };
        });
      const episodes = reconstruction.episodes.slice(0, 16).map((episode, episodeIndex) => {
        const sourceEvents = episode.timeline.slice(0, 24).flatMap((timeline) => {
          const event = eventsById.get(timeline.sourceEventId);
          if (!event) return [];
          const ref = addEvidence({
            matchId: match.matchId,
            eventId: event.sourceEventId,
            timeSeconds: event.timeSeconds,
            kind: `battle:${event.type.toLocaleLowerCase('en-US')}`,
            matchRef,
            occurredAt: match.createdAt ?? new Date(match.timestamp).toISOString(),
            detail: `${match.mapName} · ${event.type} · ${event.timeSeconds === null ? '时间未知' : `${Math.floor(event.timeSeconds / 60)}:${String(Math.floor(event.timeSeconds % 60)).padStart(2, '0')}`} · ${safePlayer(event.actorId) ?? '未知'}${event.victimId ? ` → ${safePlayer(event.victimId)}` : ''}`,
            actor: safePlayer(event.actorId),
            victim: safePlayer(event.victimId),
            damage: event.type === 'DAMAGE' ? event.damage : null,
          });
          return [{ ref, type: event.type, timeSeconds: event.timeSeconds, actor: safePlayer(event.actorId), victim: safePlayer(event.victimId), damage: event.type === 'DAMAGE' ? event.damage : null }];
        });
        return {
          episodeRef: `B${String(episodeIndex + 1).padStart(2, '0')}`,
          startSeconds: episode.startSeconds,
          endSeconds: episode.endSeconds,
          durationSeconds: episode.durationSeconds,
          firstKnockRef: episode.firstKnock ? sourceAliases.get(`${match.matchId}\u001f${episode.firstKnock.sourceEventId}\u001fbattle:knock`) ?? null : null,
          participantAliases: episode.participantRefs.map((ref) => {
            const player = match.players.find((candidate) => battlePlayerRef(match.matchId, candidate.accountId) === ref);
            return player ? safePlayer(player.accountId) : 'OPPONENT_UNKNOWN';
          }),
          teams: episode.teams.map((team) => ({ tracked: team.tracked, lastObserved: team.lastObserved })),
          events: sourceEvents,
        };
      });
      const circleTransitions = reconstruction.circleTransitions.slice(0, 24).map((transition, index) => {
        const from = telemetry.events.find((event) => event.sourceEventId === transition.fromSourceEventId);
        const to = telemetry.events.find((event) => event.sourceEventId === transition.toSourceEventId);
        const beforeRef = from ? addEvidence({
          matchId: match.matchId, eventId: from.sourceEventId, timeSeconds: from.timeSeconds, kind: 'circle-transition-before', matchRef,
          occurredAt: match.createdAt ?? new Date(match.timestamp).toISOString(), detail: `${match.mapName} · circle sample before transition`, actor: null, victim: null, damage: null,
        }) : null;
        const afterRef = to ? addEvidence({
          matchId: match.matchId, eventId: to.sourceEventId, timeSeconds: to.timeSeconds, kind: 'circle-transition-after', matchRef,
          occurredAt: match.createdAt ?? new Date(match.timestamp).toISOString(), detail: `${match.mapName} · circle sample after transition`, actor: null, victim: null, damage: null,
        }) : null;
        return { transitionRef: `C${String(index + 1).padStart(2, '0')}`, timeSeconds: transition.timeSeconds, changedZones: transition.changedZones, evidenceRefs: [beforeRef, afterRef].filter((ref): ref is string => Boolean(ref)) };
      });
      return {
        status: reconstruction.status,
        matchRef,
        parserVersion: reconstruction.parserVersion,
        schemaVersion: reconstruction.schemaVersion,
        episodes,
        omittedEpisodeCount: Math.max(0, reconstruction.episodes.length - episodes.length),
        circleTransitions,
        combatFeatures,
        battles: battleSummaries,
        evidenceRefs: [...new Set([
          ...episodes.flatMap((episode) => episode.events.map((event) => event.ref)),
          ...circleTransitions.flatMap((row) => row.evidenceRefs),
          ...(combatFeatures?.weapons.flatMap((item) => item.evidenceRefs) ?? []),
          ...(combatFeatures?.fights.flatMap((item) => item.evidenceRefs) ?? []),
          ...battleSummaries.flatMap((battle) => battle.evidenceRefs),
        ])],
      };
    },
    lookupEvidence: ({ evidenceRefs }) => ({
      items: evidenceRefs.flatMap((ref) => {
        const detail = evidenceDetails.get(ref);
        return detail ? [{ ref, matchRef: detail.matchRef, occurredAt: detail.occurredAt, timeSeconds: detail.timeSeconds, kind: detail.kind, detail: detail.detail, actor: detail.actor, victim: detail.victim, damage: detail.damage }] : [];
      }),
      evidenceRefs: evidenceRefs.filter((ref) => evidenceDetails.has(ref)),
    }),
  };
  return { tools, evidenceByAlias, labels };
}

export function deterministicAssistantFallback(question: string, reportAnswer: string, action: string): { answer: string; evidenceRefs: string[]; citeReportEvidence: boolean } {
  const normalized = question.normalize('NFKC').toLocaleLowerCase('zh-CN');
  const thirdCircleWipe = /第三(?:个)?圈|third\s+circle/iu.test(normalized)
    && /团灭|全灭|wipe/iu.test(normalized)
    && /为什么|原因|经常|频繁|why/iu.test(normalized);
  if (thirdCircleWipe) {
    return {
      answer: '当前数据没有可核实的毒圈阶段编号和团灭因果标签，不能确认“第三圈经常团灭”。我先不推断原因。',
      evidenceRefs: [],
      citeReportEvidence: false,
    };
  }
  const directedRevive = /谁救谁|谁.{0,8}(救|扶|拉).{0,8}谁|who.{0,12}revive/iu.test(normalized);
  if (directedRevive) {
    return {
      answer: 'Match Store 只提供队员救援总数，不能确定具体是谁救了谁；当前没有 AI 分析可用的事件级证据，我先不比较救援方向。',
      evidenceRefs: [],
      citeReportEvidence: false,
    };
  }
  if (action === 'unsupported') {
    return {
      answer: '我目前只研究当前选定小队的 PUBG 对局。可以问最近伤害趋势、队员对比、地图表现，或指定一场比赛复盘团战。',
      evidenceRefs: [],
      citeReportEvidence: false,
    };
  }
  if (action === 'unsupported' || action === 'telemetry_coverage') return { answer: reportAnswer, evidenceRefs: [], citeReportEvidence: false };
  return { answer: reportAnswer, evidenceRefs: [], citeReportEvidence: true };
}