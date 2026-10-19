import type { PubgPresentation } from '@agent/presentation';

/*
 * How to retell each kind of PUBG answer. Skills load lazily and a chat agent rarely reads them, so the guide travels
 * with the tool result instead: the agent sees the writing contract in the same message as the facts.
 * Guides describe shape and voice only; every number still comes from displayText.
 */

export const STATS_REPLY_GUIDE = [
  '这是一份战绩查询结果。回复就是一份完整战报，按下面的结构写，不要压缩成一行一人的短列表：',
  '1. 开场一两句 Kurisu 口吻：按称呼名册点名提问的人，评论当天的局数、吃鸡或最亮眼的数字。',
  '2. 原样保留 displayText 的标题行（🏆 …）。',
  '3. 每个队员一张卡，顺序和勋章（🥇🥈🥉🎖️，按 K/D 排）与 displayText 一致，不要自己重排：',
  '   - 名字行：可在名字前加一个贴切的外号，名字换成名册里的称呼，括号保留 PUBG 账号，例如「🥈 **火力真大核：变态猴（SG_LabmemNo004）**」。',
  '   - 「• 出战 N 局：…」和「• 个人数据：…」两行逐字照抄，数字、称号（全队助攻王 / 全队伤害第一 / 破点王 / 全队救援王）和 **加粗** 一个不能少。',
  '   - 再加一行「• AI 锐评：…」，一两句毒舌或夸奖，只引用这个人卡片上的真实数字。',
  '4. 「团队合计：…」一行原样保留并加粗。',
  '5. 收尾一两句傲娇吐槽，点名谁 carry、谁死得最多或谁拉人最多，落在称呼上。',
  '6. displayText 最后的 🔗 分享链接原样放在回复最后一行。',
  '不得编造数字、外号以外的事实或 displayText 里没有的称号。',
  '',
  '写法示例（数字仅示意，实际以 displayText 为准）：',
  '……变态猴！下午还嚷嚷着让我吃子弹，晚上一查战绩，你这火力全倾泻在敌人身上了啊？！',
  '',
  '🏆 10月18日星期日 全天战报',
  '',
  '🥇 **效率杀手：Nori（kim_kkl）**',
  '• **出战 3 局**：**5 杀**，1 助攻，1283.7 伤害，9 击倒，1 救援，2 爆头，2 次前十',
  '• 个人数据：**KD 1.67**，场均伤害 427.9，最远击杀 314.3m，3 死',
  '• AI 锐评：只玩了三把，KD 1.67 全队最高，场均 427.9 伤害，每把都在暴力抽靶，打完就跑，标准的效率派。',
  '',
  '🥈 **火力真大核·反派逆袭：变态猴（SG_LabmemNo004）**',
  '• **出战 8 局**：**10 杀**，**11 助攻（全队助攻王）**，**2743.0 伤害（全队伤害第一）**，**15 击倒（破点王）**，3 救援，3 爆头，6 次前十，**1 吃鸡**',
  '• 个人数据：**KD 1.43**，场均伤害 342.9，最远击杀 318.5m，7 死',
  '• AI 锐评：下午还在问自己是不是反派，今晚直接化身终极大 BOSS！8 局轰了 2700 多伤害外加 11 个助攻，这火力确实没得黑。',
  '',
  '（其余队员同样一人一张卡）',
  '',
  '**团队合计：29 杀，6779.9 伤害，40 击倒，18 助攻，14 救援，团队 KD 1.00，吃鸡 1**',
  '',
  '变态猴单人砍了 2743 点输出，看来考完试脑神经元彻底释放了。都快半夜了，战报查爽了就赶紧关电脑睡觉去，笨蛋！',
  '',
  '🔗 （displayText 里的分享链接）',
].join('\n');

export const TEAM_DAMAGE_REPLY_GUIDE = [
  '这是一份队内误伤（队友互相伤害）账本。回复写成完整的「对账」战报，不要压缩成几行短列表：',
  '1. 开场一两句 Kurisu 口吻：点名提问的人，接上他刚说的话或今天的梗。',
  '2. 总账：保留 displayText 的总误伤、总命中和括号里的分类（飞踢 / 重拳 / 载具撞击 / 走火）。',
  '3. 「互相伤害明细」逐条保留每个方向：名字换成名册称呼、括号保留 PUBG 账号，可以给方向起一个小标题（如「狂气压制」「疯狂反扑」「边境暗算」）；',
  '   每条下面保留「总输出：N 次命中，造成 X 伤害（分类）」，再补一句只引用这条数字的吐槽。',
  '   两个人互相打时，算出两人对攻合计和占全队误伤的比例（只用 displayText 的数字计算）。',
  '4. 「名场面」原样保留每一局的局号、地图、名次和每个方向的次数与伤害，再加一句画面感的描述。',
  '5. 清白名单里的人点名表扬一句（0 次主动队内输出）。',
  '6. 总结两三句：谁是内耗核心、谁挨打最多，落在称呼上傲娇收尾。',
  '没有任何方向时，直接说今天没有队内误伤记录，不要编。数据不完整时说明哪些未知，不要把未知当 0。',
  '',
  '写法示例（数字仅示意）：',
  '……刚自封完「天上天下唯我独尊」，一转头就来对账了是吧，变态猴！',
  '',
  '🥊 10月18日星期日 队内误伤账本',
  '• 总误伤：**738.8 点**',
  '• 总命中：**37 次**（飞踢 33 次、重拳 2 次、小轿车撞击 2 次）',
  '',
  '───',
  '',
  '**互相伤害明细（共 4 个方向）：**',
  '1. **狂气压制：Arthur（SG_LabmemNo007） ➡️ 变态猴（SG_LabmemNo004）**',
  '  • 总输出：**16 次命中，造成 334.7 伤害**（飞踢 16 次）',
  '  • 狂气所长只要近身，脚尖就焊死在你身上，单向对内输出全场最高！',
  '2. **疯狂反扑：变态猴（SG_LabmemNo004） ➡️ Arthur（SG_LabmemNo007）**',
  '  • 总输出：**16 次命中，造成 267.0 伤害**（飞踢 14 次、重拳 2 次）',
  '  • 你们俩今天整整 32 次肉搏互换，对攻 601.7 点，占全队内讧的 81%！',
  '',
  '───',
  '',
  '**名场面：**',
  '• 第 9 局（米拉玛 #12，21:01）：单局 **263.5 点（12 次命中）**：Arthur ➡️ 变态猴 7 次 174.5 点；变态猴 ➡️ Arthur 5 次 89.0 点。两人在沙漠里踢得尘土飞扬！',
  '',
  '清白名单：打工战士今天继续保持清白，0 次主动队内输出。',
  '',
  '总结：对外你是 MVP，对内你挨了 334 点、还了 267 点，稳稳领跑全场内耗核心！账本焊死在这了，赶紧关机睡觉去，最强肉盾猴！',
].join('\n');

export const MATCH_LIST_REPLY_GUIDE = [
  '这是一份对局列表。回复保留 displayText 里每一局的序号、时间、地图、名次和每个人的击杀 / 伤害，名字换成名册称呼；',
  '开场一两句点名提问的人，结尾一两句点评（哪局最好、哪局最惨、谁最稳），只引用列表里的数字。',
  '如果用户是在问「只看四排 / 去掉双排后的 KD」这类问题，先说明列表的筛选条件，再按列表里的数字逐人算出结果，写清算法（例如 KD = 击杀 ÷ 死亡），不要编死亡数之类列表里没有的数字。',
].join('\n');

export const GENERAL_REPLY_GUIDE = [
  '回复以 displayText 为事实块：保留其中所有数字、名次、称号和链接，名字换成名册称呼；',
  '前后加 Kurisu 口吻的开场和点评，点评只引用 displayText 里的真实数字，不要把事实块压缩成一两句。',
].join('\n');

export const NO_MATCHES_REPLY_GUIDE = '没有找到符合条件的比赛：用 Kurisu 口吻如实说明查询的时间范围里没有对局（可以吐槽一句），不要编任何数字，也不要拿以前的战绩代替。';
export const PARTIAL_REPLY_GUIDE = '数据不完整：照常写回复，但要点明哪些部分缺失或未知；未知不是 0，不要补全或猜测。';
export const ERROR_REPLY_GUIDE = '这次查询失败：用一两句如实说明没查到、请稍后再试，不要用聊天记录里的旧数字回答。';

/** The guide for a result, or undefined when the result needs none (internal tools, plain status messages). */
export function replyGuideFor(presentation: PubgPresentation): string | undefined {
  if (presentation.status === 'error') return ERROR_REPLY_GUIDE;
  if (presentation.status === 'no_matches') return NO_MATCHES_REPLY_GUIDE;
  const guide = presentation.type === 'pubg_stats' ? (presentation.rows.length ? STATS_REPLY_GUIDE : undefined)
    : presentation.type === 'pubg_team_damage' ? TEAM_DAMAGE_REPLY_GUIDE
      : presentation.type === 'pubg_match_list' ? MATCH_LIST_REPLY_GUIDE
        : presentation.type === 'pubg_status' ? undefined
          : GENERAL_REPLY_GUIDE;
  if (!guide) return undefined;
  return presentation.status === 'partial' ? `${guide}\n${PARTIAL_REPLY_GUIDE}` : guide;
}
