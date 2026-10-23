import { classifyResearchQuestion, type ResearchAssistantResult } from '@rine-kit/pubg-intelligence';

const CONVERSATION_PROMPT = '我目前只研究当前选定小队的 PUBG 对局。可以问“最近伤害趋势”“按地图比较前十率”“比较队员击杀”，或选一场比赛复盘团战。你想先看哪项？';

export function shortConversationReply(question: string): string | undefined {
  const normalized = question.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
  const compact = normalized.replace(/[\s\p{P}\p{S}]/gu, '');
  if (!compact || [...compact].length > 36 || classifyResearchQuestion(question).action !== 'unsupported') return undefined;
  const knownEvidenceGap = (/第三(?:个)?圈|third\s+circle/iu.test(normalized)
    && /团灭|全灭|wipe/iu.test(normalized)
    && /为什么|原因|经常|频繁|why/iu.test(normalized))
    || /谁救谁|谁.{0,8}(救|扶|拉).{0,8}谁|who.{0,12}revive/iu.test(normalized);
  if (knownEvidenceGap) return undefined;

  if (/^(你好|您好|嗨|哈喽|hello|hi|hey|早|早上好|晚上好|晚安|在吗|有人吗)+$/iu.test(compact)) {
    return '你好！我可以帮你复盘当前小队的 PUBG 对局：看伤害趋势、队员对比、地图表现，或一场团战的事件证据。你想先看哪一项？';
  }
  if (/^(谢谢|感谢|多谢|辛苦了|thanks|thankyou|thx)+$/iu.test(compact)) {
    return '不客气。想继续的话，可以问“最近伤害趋势”或“复盘某场团战”，我会按当前小队和日期范围查证据。';
  }
  if (/^(你是谁|你能做什么|你能干什么|你会什么)+$/iu.test(compact)) {
    return '我是 PUBG Intelligence Lab 的本地研究助手，能基于当前选定小队和日期范围查看比赛统计、单局事件和团战证据。你想先看哪项？';
  }
  return CONVERSATION_PROMPT;
}

export function researchRecoveryMessage(reason: ResearchAssistantResult['degradedReason']): string | null {
  switch (reason) {
    case 'model_unavailable':
      return '研究模型未连接。检查本机 9Router 是否在配置地址运行，并确认外部配置文件权限为 0600，再重试。';
    case 'model_request_failed':
      return '连接 arthur-combo 失败。检查 9Router 本机服务和模型路由状态，然后重试。';
    case 'no_read_tool_used':
      return '这次回答没有读取可核验的比赛证据。请改问当前小队的一项统计，或指定一场比赛。';
    case 'invalid_grounded_output':
      return '有些内容缺少可核验的比赛或事件依据，已保留通过校验的结论；无法核实的内容已改用本机统计或省略。若要补全打法分析，请指定时间范围，或选择有 Telemetry 记录的比赛。';
    default:
      return null;
  }
}
