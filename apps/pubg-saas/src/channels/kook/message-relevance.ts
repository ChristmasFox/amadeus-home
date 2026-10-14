export type KookGroupMessageRelevance = 'management_command' | 'binding_intent' | 'query_candidate' | 'irrelevant';

const BINDING_PHRASE = /(?:我的|他的|她的|本人|我).{0,24}(?:PUBG|绝地求生).{0,12}(?:账号|帐号)|(?:PUBG|绝地求生).{0,12}(?:账号|帐号).{0,24}(?:是|叫)|(?:我们的|本队|我们).{0,8}队名/iu;
const STAT_TERM = /(?:战绩|击杀|伤害|对局|误伤|队友(?:伤害|击杀)|KD|K\/D|胜率|吃鸡|排行榜|榜单|存活|助攻|复活|治疗|数据)/iu;
const QUERY_CUE = /(?:查|查询|看下|看看|统计|多少|谁|哪个|哪位|排名|排行|如何|怎样|怎么样|比较|对比|最近|今天|今日|昨天|昨晚|本周|上周|上一局|上把|[？?])/iu;
const ENGLISH_STAT_TERM = /\b(?:stats?|kills?|damage|matches|kd|win(?:s|rate)?)\b/iu;
const ENGLISH_QUERY_CUE = /\b(?:show|check|how many|what|who|compare|rank(?:ing)?|recent|today|yesterday)\b/iu;

/** A bounded local prefilter. It admits only recognizable PUBG writes, public
 * queries, or explicit commands; plain group chatter is never sent to a model. */
export function classifyKookGroupMessage(content: string): KookGroupMessageRelevance {
  const trimmed = content.trim();
  if (/^(?:\/|!)pubg(?:\s|$)/iu.test(trimmed)) return 'management_command';
  if (BINDING_PHRASE.test(trimmed)) return 'binding_intent';
  if ((STAT_TERM.test(trimmed) && QUERY_CUE.test(trimmed))
    || (ENGLISH_STAT_TERM.test(trimmed) && ENGLISH_QUERY_CUE.test(trimmed))) return 'query_candidate';
  return 'irrelevant';
}

export function isKookGroupBindingPhrase(content: string): boolean {
  return BINDING_PHRASE.test(content);
}
