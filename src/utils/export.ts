import { PickResult } from '../almanac/pick-day';
import { FarmTip, getFarmTipByDate } from '../almanac/farm';

// 导出范围
export type ExportScope = 'best' | 'good' | 'all';

export const SCORE_BEST = 80;
export const SCORE_GOOD = 60;

// 导出内容勾选项
export interface ExportFieldOptions {
  ganZhi: boolean;   // 干支
  score: boolean;    // 评分
  reason: boolean;   // 推荐理由
  yi: boolean;       // 宜
  ji: boolean;       // 忌
  chongSha: boolean; // 冲煞
  zhiShen: boolean;  // 值神
  farm: boolean;     // 农事提示
}

export const DEFAULT_FIELD_OPTIONS: ExportFieldOptions = {
  ganZhi: true,
  score: true,
  reason: true,
  yi: true,
  ji: true,
  chongSha: true,
  zhiShen: true,
  farm: true,
};

export interface ExportOptions {
  scope: ExportScope;
  fields: ExportFieldOptions;
}

// 版式常量（px，设计宽度 720，按 scale=3 出图）
export const PAGE = {
  WIDTH: 720,
  HEIGHT: 1080,
  PADDING_X: 32,
  PADDING_TOP: 28,
  PADDING_BOTTOM: 28,
  CARD_PADDING: 16,
  CARD_GAP: 14,
  BODY_GAP: 32, // 正文区上下 margin 各 16px
};

// 首页/续页的头部高度
const FIRST_HEADER_H = 132;
const CONT_HEADER_H = 76;
// 页脚高度
const FOOTER_H = 36;
// 末页"清单完"收尾行高度
const END_NOTE_H = 52;

// 卡片各行高度
const CARD_DATE_ROW_H = 34;
const CARD_BLOCK_GAP = 8;
const CHIP_H = 33;
const CHIP_GAP = 6;
const CHIP_CHAR_W = 15;
const CHIP_PAD_X = 18;

// 按范围筛选结果（结果已按分数降序）
export function selectResults(results: PickResult[], scope: ExportScope): PickResult[] {
  const min = scope === 'best' ? SCORE_BEST : scope === 'good' ? SCORE_GOOD : 0;
  return results.filter(r => r.score >= min);
}

// 取某日农事提示
export function getFarmTipFor(r: PickResult): FarmTip | undefined {
  return getFarmTipByDate(r.year, r.month, r.day, r.solarTerm);
}

// 卡片正文可用宽度
function cardInnerWidth(): number {
  return PAGE.WIDTH - PAGE.PADDING_X * 2 - PAGE.CARD_PADDING * 2;
}

// 估算单行标签容器需要的高度（标签换行，估算偏保守）
function chipsHeight(items: string[]): number {
  if (items.length === 0) return 0;
  const inner = cardInnerWidth();
  let rows = 1;
  let rowWidth = 0;
  for (const text of items) {
    const w = CHIP_PAD_X + text.length * CHIP_CHAR_W;
    if (rowWidth > 0 && rowWidth + CHIP_GAP + w > inner) {
      rows++;
      rowWidth = w;
    } else {
      rowWidth += (rowWidth > 0 ? CHIP_GAP : 0) + w;
    }
  }
  return rows * CHIP_H + (rows - 1) * CHIP_GAP;
}

// 普通文本块按字符数估算折行后的高度（charW 为保守的单字宽）
function textLineHeight(text: string, fontSize: number, lineHeight: number, prefixWidth = 0): number {
  const inner = cardInnerWidth() - prefixWidth;
  const perLine = Math.max(6, Math.floor(inner / fontSize));
  const lines = Math.max(1, Math.ceil(text.length / perLine));
  return Math.round(lines * fontSize * lineHeight);
}

// 估算单张卡片高度
export function estimateCardHeight(r: PickResult, fields: ExportFieldOptions): number {
  let h = PAGE.CARD_PADDING * 2 + CARD_DATE_ROW_H; // 日期行恒有

  const textBlocks: number[] = [];
  if (fields.ganZhi) {
    const reason = fields.reason ? r.reason : '';
    textBlocks.push(textLineHeight(reason ? `${r.ganZhi}日 · ${reason}` : `${r.ganZhi}日`, 15, 1.6));
  } else if (fields.reason && r.reason) {
    textBlocks.push(textLineHeight(r.reason, 15, 1.6));
  }

  const chipBlocks: number[] = [];
  if (fields.yi) {
    const ch = chipsHeight(r.yi);
    if (ch > 0) chipBlocks.push(ch);
  }
  if (fields.ji) {
    const ch = chipsHeight(r.ji);
    if (ch > 0) chipBlocks.push(ch);
  }

  if (fields.chongSha || fields.zhiShen) {
    const parts: string[] = [];
    if (fields.chongSha) parts.push(`冲${r.chong}（${chongShengxiao(r.chong)}）煞${r.sha}`);
    if (fields.zhiShen) parts.push(`值神：${r.zhiShen}`);
    textBlocks.push(textLineHeight(parts.join(' · '), 14, 1.6));
  }

  if (fields.farm && getFarmTipFor(r)) {
    const tip = getFarmTipFor(r)!;
    // 按最长农事任务串折行估算，再加顶部虚线分隔与上间距
    const farmText = `农事 · ${tip.term}：${tip.tasks.join('、')}`;
    textBlocks.push(8 + textLineHeight(farmText, 13, 1.7, 0));
  }

  const blocks = [...textBlocks, ...chipBlocks];
  h += blocks.length * CARD_BLOCK_GAP + blocks.reduce((a, b) => a + b, 0);
  return h;
}

// 首页/续页可用正文高度
export function bodyCapacity(pageIndex: number): number {
  const header = pageIndex === 0 ? FIRST_HEADER_H : CONT_HEADER_H;
  return PAGE.HEIGHT - PAGE.PADDING_TOP - PAGE.PADDING_BOTTOM - header - PAGE.BODY_GAP - FOOTER_H;
}

// 贪心分页：卡片不跨页；返回每页卡片数量（末尾若为 0 表示该页只有"清单完"收尾行）
export function paginate(results: PickResult[], fields: ExportFieldOptions): number[] {
  if (results.length === 0) return [];
  const pages: number[] = [];
  let pageIndex = 0;
  let used = 0;
  let count = 0;

  const flush = (): number => {
    const pageUsed = used;
    pages.push(count);
    pageIndex++;
    used = 0;
    count = 0;
    return pageUsed;
  };

  results.forEach((r) => {
    const card = estimateCardHeight(r, fields);
    if (count > 0 && used + PAGE.CARD_GAP + card > bodyCapacity(pageIndex)) {
      flush();
    }
    if (count > 0) used += PAGE.CARD_GAP;
    used += card;
    count++;
  });

  if (count > 0) {
    const lastUsed = flush();
    // 末页放不下"清单完"收尾行时，单独再起一页
    if (lastUsed + PAGE.CARD_GAP + END_NOTE_H > bodyCapacity(pageIndex - 1)) {
      pages.push(0);
    }
  }
  return pages;
}

// 预计页数（供导出前预览）
export function estimatePageCount(results: PickResult[], fields: ExportFieldOptions): number {
  return paginate(results, fields).length;
}

// 日期标签
export function formatDateLabel(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// 字节数转可读大小
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// 导出文件名：日期 + 时分秒 + 页数 + 同秒序号
export function buildExportFileName(now: Date, totalPages: number, sameSecondSeq: number): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const seq = sameSecondSeq > 0 ? `_${sameSecondSeq + 1}` : '';
  const pagePart = totalPages > 1 ? `_${totalPages}页` : '';
  return `吉日清单_${stamp}${pagePart}${seq}`;
}

// 冲煞地支 → 被冲生肖
export function chongShengxiao(chong: string): string {
  const map: Record<string, string> = {
    '子': '鼠', '丑': '牛', '寅': '虎', '卯': '兔', '辰': '龙', '巳': '蛇',
    '午': '马', '未': '羊', '申': '猴', '酉': '鸡', '戌': '狗', '亥': '猪',
  };
  return map[chong] || '';
}

// data URL 解码后的字节数（PNG base64 长度 × 3/4）
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] || '';
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}
