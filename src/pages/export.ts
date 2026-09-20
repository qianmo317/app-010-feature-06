import { PickResult } from '../almanac/pick-day';
import { getFarmTipByDate } from '../almanac/farm';
import { createElement } from '../utils/dom';
import html2canvas from 'html2canvas';

// ===== 导出配置 =====

export interface ExportOptions {
  range: 'best' | 'good'; // best=仅大吉(≥80)，good=吉及以上(≥60)
  includeJi: boolean;
  includeChongSha: boolean;
  includeZhiShen: boolean;
  includeFarm: boolean;
  includeReason: boolean;
}

export interface ExportMeta {
  events: string[];
  startDate: string;
  endDate: string;
  avoid: string[];
}

const DEFAULT_OPTIONS: ExportOptions = {
  range: 'good',
  includeJi: true,
  includeChongSha: true,
  includeZhiShen: true,
  includeFarm: true,
  includeReason: true,
};

// 页面固定尺寸（逻辑像素，按 2 倍渲染）——保证手机查看时字号足够大
const PAGE_W = 720;
const PAGE_H = 1080;
const RENDER_SCALE = 2;
const BG = '#f7f3e9';

// 正文可用高度（页面总高减去页眉/页脚/标题块与固定留白）
// 第一页含标题块，后续页只有页眉、页脚，留白与边距所有页保持一致
const BODY_H_FIRST = 720;
const BODY_H_OTHER = 906;
const CARD_GAP = 18;

/**
 * 按固定行高预算把日期卡片分到多页（纯函数，便于校验边界）。
 * 实际渲染时仍以浏览器布局测量兜底，卡片绝不跨页截断。
 * heights[i] 为第 i 张卡片的估算高度；返回每页的卡片下标区间。
 */
export function paginateByHeights(
  heights: number[],
  bodyHFirst = BODY_H_FIRST,
  bodyHOther = BODY_H_OTHER,
  gap = CARD_GAP,
): Array<[number, number]> {
  const pages: Array<[number, number]> = [];
  let start = 0;

  const capacityFor = (pageIdx: number) => (pageIdx === 0 ? bodyHFirst : bodyHOther);

  while (start < heights.length) {
    const capacity = capacityFor(pages.length);
    let used = 0;
    let end = start;
    while (end < heights.length) {
      const need = heights[end] + (end > start ? gap : 0);
      if (used + need > capacity) break;
      used += need;
      end += 1;
    }
    if (end === start) {
      // 单卡超过整页容量：独占一页（生产代码会记录警告）
      end = start + 1;
    }
    pages.push([start, end]);
    start = end;
  }
  return pages;
}

/**
 * 根据勾选项估算单张吉日卡片的排版高度（与导出图字号、行距保持一致）。
 */
export function estimateCardHeight(r: PickResult, options: ExportOptions): number {
  let h = 18 * 2 + 44 + 6 + 36; // padding + 日期行 + 间距 + 干支行
  h += 8; // 干支行下间距

  if (options.includeZhiShen) h += 33;
  if (options.includeChongSha) h += 33;

  const yiLines = estimateTagLines(r.yi.length);
  h += 22 * 1.6 * Math.max(1, yiLines) + 4;

  if (options.includeJi) {
    const jiLines = estimateTagLines(r.ji.length);
    h += 22 * 1.6 * Math.max(1, jiLines);
  }

  if (options.includeFarm) {
    const tip = getFarmTipByDate(r.year, r.month, r.day, r.solarTerm);
    if (tip) h += 33 * estimateFarmLines(tip.tasks.join('、').length);
  }

  if (options.includeReason) h += 32 * Math.max(1, Math.ceil(r.reason.length / 30));

  return h;
}

function estimateTagLines(count: number): number {
  if (count === 0) return 1;
  // 每张标签约占 72px，正文宽约 632px
  return Math.ceil((count * 72) / 632);
}

function estimateFarmLines(textLen: number): number {
  return Math.max(1, Math.ceil((textLen + 10) / 28));
}

const FONT_STACK = '"Noto Serif SC", "Source Han Serif SC", "PingFang SC", "Microsoft YaHei", serif';
const WEEK_CHARS = '日一二三四五六';

interface ExportedFile {
  name: string;
  url: string;
  size: number;
  pageIndex: number;
}

interface ExportRecord {
  id: number;
  createdAt: Date;
  status: 'rendering' | 'done' | 'failed';
  options: ExportOptions;
  dayCount: number;
  pageCount: number;
  renderedPages: number;
  errorMessage: string;
  files: ExportedFile[];
  baseName: string;
}

let styleInjected = false;
let recordSeq = 0;
let exportCounter = 0;

/** 仅供测试：重置会话级导出序号 */
export function __resetExportCounterForTest(): void {
  exportCounter = 0;
  recordSeq = 0;
}

// ===== 面板入口 =====

export function renderExportPanel(
  container: HTMLElement,
  results: PickResult[],
  meta: ExportMeta,
): HTMLElement {
  if (!styleInjected) {
    injectExportStyles();
    styleInjected = true;
  }

  const options: ExportOptions = { ...DEFAULT_OPTIONS };
  const records: ExportRecord[] = [];

  const panel = createElement('div', 'export-panel card');

  const panelTitle = createElement('h3', undefined, '导出吉日清单');
  panel.appendChild(panelTitle);

  // --- 导出范围 ---
  const rangeSection = createElement('div', 'export-group');
  rangeSection.appendChild(createElement('div', 'export-group-label', '导出范围'));
  const rangeBox = createElement('div', 'export-range-box');

  const bestCount = results.filter(r => r.score >= 80).length;
  const goodCount = results.filter(r => r.score >= 60).length;

  const bestRadio = buildRadio('best', '仅大吉之日', `共 ${bestCount} 天`, options.range === 'best');
  const goodRadio = buildRadio('good', '大吉与吉日', `共 ${goodCount} 天`, options.range === 'good');
  rangeBox.append(bestRadio.label, goodRadio.label);
  bestRadio.input.addEventListener('change', () => {
    options.range = 'best';
    bestRadio.label.classList.add('checked');
    goodRadio.label.classList.remove('checked');
    updateCountHint();
  });
  goodRadio.input.addEventListener('change', () => {
    options.range = 'good';
    goodRadio.label.classList.add('checked');
    bestRadio.label.classList.remove('checked');
    updateCountHint();
  });
  rangeSection.appendChild(rangeBox);

  // --- 内容勾选 ---
  const contentSection = createElement('div', 'export-group');
  contentSection.appendChild(createElement('div', 'export-group-label', '图片内容（默认全选）'));
  const checkboxGrid = createElement('div', 'export-option-grid');

  const optionDefs: Array<{ key: keyof ExportOptions; label: string; desc: string }> = [
    { key: 'includeJi', label: '今日所忌', desc: '完整忌事，不再只画四个宜' },
    { key: 'includeChongSha', label: '冲煞', desc: '如「冲狗煞南」' },
    { key: 'includeZhiShen', label: '值神 / 建星', desc: '如「青龙 · 建」' },
    { key: 'includeFarm', label: '农事提示', desc: '节气与当季农事' },
    { key: 'includeReason', label: '推荐理由', desc: '评分依据与避讳说明' },
  ];
  for (const def of optionDefs) {
    const { label, input } = buildCheckbox(def.label, def.desc, options[def.key] as boolean);
    input.addEventListener('change', () => {
      (options[def.key] as boolean) = input.checked;
      label.classList.toggle('checked', input.checked);
    });
    checkboxGrid.appendChild(label);
  }
  contentSection.appendChild(checkboxGrid);

  // --- 固定带项说明 ---
  const baseHint = createElement('div', 'export-base-hint',
    '日期、星期、干支、农历、分数为固定信息，始终包含；不再限制 50 条，全部导出。');
  contentSection.appendChild(baseHint);

  // --- 数量提示 + 生成按钮 ---
  const countHint = createElement('div', 'export-count-hint');
  const generateBtn = createElement('button', 'export-generate-btn') as HTMLButtonElement;
  generateBtn.type = 'button';
  generateBtn.addEventListener('click', () => {
    const record = createRecord(options, countFor(options));
    records.unshift(record);
    renderRecords();
    void runExport(record, results, meta, renderRecords);
  });

  // --- 导出记录 ---
  const recordsArea = createElement('div', 'export-records');

  function countFor(opts: ExportOptions): number {
    return opts.range === 'best' ? bestCount : goodCount;
  }

  function updateCountHint() {
    const n = countFor(options);
    if (n === 0) {
      countHint.textContent = '该范围内没有可导出的日期';
      generateBtn.disabled = true;
    } else {
      countHint.textContent = `将导出 ${n} 天，自动按固定字号分成一页或多页，每页一个图片文件`;
      generateBtn.disabled = false;
    }
  }

  function createRecord(opts: ExportOptions, dayCount: number): ExportRecord {
    recordSeq += 1;
    exportCounter += 1; // 每次点击生成占用一个序号，保证文件名新旧可分
    return {
      id: recordSeq,
      createdAt: new Date(),
      status: 'rendering',
      options: { ...opts },
      dayCount,
      pageCount: 0,
      renderedPages: 0,
      errorMessage: '',
      files: [],
      baseName: buildBaseName(new Date(), exportCounter),
    };
  }

  function renderRecords() {
    recordsArea.innerHTML = '';
    if (records.length === 0) return;

    const listTitle = createElement('div', 'export-records-title', '本次浏览的导出记录');
    recordsArea.appendChild(listTitle);

    records.forEach((record) => {
      recordsArea.appendChild(buildRecordElement(record, results, meta, renderRecords));
    });
  }

  panel.append(rangeSection, contentSection, countHint, generateBtn, recordsArea);
  container.appendChild(panel);
  updateCountHint();

  return panel;
}

// ===== 导出执行 =====

async function runExport(
  record: ExportRecord,
  results: PickResult[],
  meta: ExportMeta,
  onUpdate: () => void,
) {
  const days = results
    .filter(r => (record.options.range === 'best' ? r.score >= 80 : r.score >= 60));

  // 重试时释放上一次生成的文件，并以新的导出时间生成文件名，避免与旧文件混淆；
  // 首次渲染沿用点击时分配的序号，重试才额外占用一个新序号
  const isRetry = record.files.length > 0 || record.status === 'failed';
  record.files.forEach(f => URL.revokeObjectURL(f.url));
  record.files = [];
  if (isRetry) {
    exportCounter += 1;
    record.createdAt = new Date();
    record.baseName = buildBaseName(record.createdAt, exportCounter);
  }
  record.status = 'rendering';
  record.errorMessage = '';
  record.renderedPages = 0;
  record.pageCount = 0;
  onUpdate();

  const root = document.createElement('div');
  root.className = 'exp-root';
  document.body.appendChild(root);

  try {
    const pages = paginate(root, days, record.options, meta, record.createdAt);
    record.pageCount = pages.length;
    onUpdate();

    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], {
        scale: RENDER_SCALE,
        useCORS: true,
        backgroundColor: BG,
        logging: false,
        width: PAGE_W,
        height: PAGE_H,
        windowWidth: PAGE_W,
      });
      const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('图片编码失败');

      const url = URL.createObjectURL(blob);
      const name = pages.length === 1
        ? `${record.baseName}.png`
        : `${record.baseName}_p${i + 1}.png`;
      record.files.push({ name, url, size: blob.size, pageIndex: i + 1 });
      record.renderedPages = i + 1;
      onUpdate();
    }

    record.status = 'done';
    onUpdate();

    // 尝试自动逐页下载（若被浏览器拦截，用户可用记录里的链接逐个保存）
    for (const f of record.files) {
      triggerDownload(f.url, f.name);
      await sleep(350);
    }
  } catch (err) {
    console.error('导出图片失败:', err);
    record.status = 'failed';
    record.errorMessage = err instanceof Error ? err.message : String(err);
    onUpdate();
  } finally {
    root.remove();
  }
}

// ===== 分页排版 =====

interface Page {
  el: HTMLElement;
  body: HTMLElement;
  pageNoEl: HTMLElement;
}

function paginate(
  root: HTMLElement,
  days: PickResult[],
  options: ExportOptions,
  meta: ExportMeta,
  createdAt: Date,
): HTMLElement[] {
  const pages: Page[] = [];

  const newPage = (withTitle: boolean): Page => {
    const el = document.createElement('div');
    el.className = 'exp-page';

    const runhead = document.createElement('div');
    runhead.className = 'exp-runhead';
    runhead.innerHTML =
      `<span>择日吉日清单</span><span>${formatDateTime(createdAt)}</span>`;

    const body = document.createElement('div');
    body.className = 'exp-body';

    const footer = document.createElement('div');
    footer.className = 'exp-footer';
    const footerNote = document.createElement('span');
    footerNote.textContent = '老黄历择日 · 仅供参考';
    const pageNoEl = document.createElement('span');
    pageNoEl.textContent = '';
    footer.append(footerNote, pageNoEl);

    el.append(runhead);
    if (withTitle) el.appendChild(buildTitleBlock(days.length, meta, createdAt));
    el.append(body, footer);
    root.appendChild(el);
    return { el, body, pageNoEl };
  };

  // 逐张入页：先由高度预算决定初始分页，再用真实布局测量兜底；卡片整体移动，绝不截断
  const heights = days.map(d => estimateCardHeight(d, options));
  const planned = paginateByHeights(heights);
  const plannedPageOf: number[] = [];
  planned.forEach(([s, e], p) => {
    for (let i = s; i < e; i++) plannedPageOf[i] = p;
  });

  let page = newPage(true);
  pages.push(page);

  days.forEach((day, i) => {
    if (i > 0 && plannedPageOf[i] !== plannedPageOf[i - 1] && page.body.children.length > 0) {
      page = newPage(false);
      pages.push(page);
    }

    const card = buildDayCard(day, options);
    page.body.appendChild(card);

    if (page.body.scrollHeight > page.body.clientHeight) {
      page.body.removeChild(card);
      page = newPage(false);
      pages.push(page);
      page.body.appendChild(card);
      if (page.body.scrollHeight > page.body.clientHeight) {
        console.warn('单日内容超过一页，该卡片可能显示不全', day);
      }
    }
  });

  pages.forEach((p, i) => {
    p.pageNoEl.textContent = `第 ${i + 1} / ${pages.length} 页`;
  });

  return pages.map(p => p.el);
}

function buildTitleBlock(totalDays: number, meta: ExportMeta, createdAt: Date): HTMLElement {
  const block = document.createElement('div');
  block.className = 'exp-title-block';

  const title = document.createElement('div');
  title.className = 'exp-title';
  title.textContent = '择日吉日清单';

  const subtitle = document.createElement('div');
  subtitle.className = 'exp-subtitle';
  subtitle.textContent = `共 ${totalDays} 个吉日 · 导出于 ${formatDateTime(createdAt)}`;

  const metaLine = document.createElement('div');
  metaLine.className = 'exp-meta-line';
  const parts = [
    `事项：${meta.events.join('、') || '未指定'}`,
    `区间：${meta.startDate} 至 ${meta.endDate}`,
  ];
  if (meta.avoid.length > 0) parts.push(`避讳：${meta.avoid.join('、')}`);
  metaLine.textContent = parts.join('　');

  block.append(title, subtitle, metaLine);
  return block;
}

function buildDayCard(r: PickResult, options: ExportOptions): HTMLElement {
  const card = document.createElement('div');
  card.className = `exp-card exp-score-${r.score >= 80 ? 'best' : 'good'}`;

  const dateStr = `${r.year}-${pad2(r.month)}-${pad2(r.day)}`;
  const weekStr = `星期${WEEK_CHARS[r.weekDay]}`;

  const head = document.createElement('div');
  head.className = 'exp-card-head';
  head.innerHTML =
    `<span class="exp-date">${escapeHtml(dateStr)} ${escapeHtml(weekStr)}</span>` +
    `<span class="exp-score">${r.score}分</span>`;
  card.appendChild(head);

  const ganzhi = document.createElement('div');
  ganzhi.className = 'exp-ganzhi';
  const lunarExtra = [r.lunarDate, r.solarTerm].filter(Boolean).join(' · ');
  ganzhi.textContent = `${r.ganZhi}日${lunarExtra ? ` · ${lunarExtra}` : ''}`;
  card.appendChild(ganzhi);

  if (options.includeZhiShen) {
    card.appendChild(buildTextRow('exp-row', `值神：${r.zhiShen} · 建星：${r.jianXing}`));
  }
  if (options.includeChongSha) {
    card.appendChild(buildTextRow('exp-row exp-row-chong', `冲${r.chongShengxiao}煞${r.sha}`));
  }

  card.appendChild(buildTagsRow('宜', r.yi, 'exp-tags-yi'));

  if (options.includeJi) {
    card.appendChild(buildTagsRow('忌', r.ji, 'exp-tags-ji', true));
  }

  if (options.includeFarm) {
    const tip = getFarmTipByDate(r.year, r.month, r.day, r.solarTerm);
    if (tip) {
      card.appendChild(buildTextRow('exp-row exp-row-farm',
        `农事 · ${tip.term}：${tip.tasks.join('、')}`));
    }
  }

  if (options.includeReason) {
    card.appendChild(buildTextRow('exp-row exp-row-reason', `提示：${r.reason}`));
  }

  return card;
}

function buildTextRow(className: string, text: string): HTMLElement {
  const row = document.createElement('div');
  row.className = className;
  row.textContent = text;
  return row;
}

function buildTagsRow(label: string, items: string[], tagsClass: string, isJi = false): HTMLElement {
  const row = document.createElement('div');
  row.className = 'exp-tags-row';

  const labelEl = document.createElement('span');
  labelEl.className = `exp-tags-label ${isJi ? 'is-ji' : 'is-yi'}`;
  labelEl.textContent = label;

  const tags = document.createElement('span');
  tags.className = `exp-tags ${tagsClass}`;
  if (items.length === 0) {
    tags.textContent = '无';
  } else {
    items.forEach((item, i) => {
      const tag = document.createElement('span');
      tag.className = 'exp-tag';
      tag.textContent = item;
      tags.appendChild(tag);
      if (i < items.length - 1) tags.appendChild(document.createTextNode(' '));
    });
  }

  row.append(labelEl, tags);
  return row;
}

// ===== 记录条目 UI =====

function buildRecordElement(
  record: ExportRecord,
  results: PickResult[],
  meta: ExportMeta,
  onUpdate: () => void,
): HTMLElement {
  const item = createElement('div', `export-record export-record-${record.status}`);

  const head = createElement('div', 'export-record-head');
  const title = createElement('div', 'export-record-title',
    `${formatTime(record.createdAt)} 导出 · ${record.dayCount} 天 · ` +
    `${record.options.range === 'best' ? '仅大吉' : '大吉与吉日'} · ` +
    `勾选 ${checkedOptionCount(record.options)} 项`);
  head.appendChild(title);

  const status = createElement('span', `export-status export-status-${record.status}`);
  head.appendChild(status);
  item.appendChild(head);

  if (record.status === 'rendering') {
    status.textContent = record.pageCount > 0
      ? `正在生成第 ${Math.min(record.renderedPages + 1, record.pageCount)} / ${record.pageCount} 页`
      : '正在排版…';
    if (record.pageCount > 0) {
      item.appendChild(createElement('div', 'export-record-detail',
        `已完成 ${record.renderedPages} / ${record.pageCount} 页，请稍候`));
    } else {
      item.appendChild(createElement('div', 'export-record-detail', '正在计算分页与边距…'));
    }
  }

  if (record.status === 'failed') {
    status.textContent = '生成失败';
    item.appendChild(createElement('div', 'export-record-error',
      `第 ${record.renderedPages + 1} 页附近出错：${record.errorMessage}`));

    if (record.files.length > 0) {
      item.appendChild(createElement('div', 'export-record-detail',
        `已生成的 ${record.files.length} 页仍可单独下载：`));
      record.files.forEach(f => item.appendChild(buildFileRow(f)));
    }

    const retryBtn = createElement('button', 'export-retry-btn', '按相同勾选重新生成') as HTMLButtonElement;
    retryBtn.type = 'button';
    retryBtn.addEventListener('click', () => {
      void runExport(record, results, meta, onUpdate);
    });
    item.appendChild(retryBtn);
  }

  if (record.status === 'done') {
    status.textContent = '已生成';
    const totalSize = record.files.reduce((sum, f) => sum + f.size, 0);
    const dims = `${PAGE_W * RENDER_SCALE}×${PAGE_H * RENDER_SCALE}`;
    item.appendChild(createElement('div', 'export-record-detail',
      `共 ${record.files.length} 个图片文件（${dims} 像素），合计 ${formatSize(totalSize)}。` +
      `若浏览器拦截了自动下载，请点下方文件逐个保存：`));

    record.files.forEach(f => item.appendChild(buildFileRow(f)));

    const downloadAll = createElement('button', 'export-download-all-btn', '全部重新下载') as HTMLButtonElement;
    downloadAll.type = 'button';
    downloadAll.addEventListener('click', () => {
      record.files.forEach((f, i) => {
        setTimeout(() => triggerDownload(f.url, f.name), i * 350);
      });
    });
    item.appendChild(downloadAll);
  }

  return item;
}

function buildFileRow(f: ExportedFile): HTMLElement {
  const row = createElement('div', 'export-file-row');
  const link = document.createElement('a');
  link.className = 'export-file-link';
  link.href = f.url;
  link.download = f.name;
  link.textContent = `⬇ ${f.name}`;
  const size = createElement('span', 'export-file-size',
    `${formatSize(f.size)} · ${PAGE_W * RENDER_SCALE}×${PAGE_H * RENDER_SCALE}`);
  row.append(link, size);
  return row;
}

// ===== 表单控件 =====

function buildRadio(value: string, label: string, hint: string, checked: boolean) {
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'export-range';
  input.value = value;
  input.checked = checked;

  const wrap = document.createElement('label');
  wrap.className = `export-radio${checked ? ' checked' : ''}`;
  const text = document.createElement('span');
  text.className = 'export-radio-text';
  text.innerHTML =
    `<span class="export-radio-label">${escapeHtml(label)}</span>` +
    `<span class="export-radio-hint">${escapeHtml(hint)}</span>`;
  wrap.append(input, text);
  return { label: wrap, input };
}

function buildCheckbox(label: string, desc: string, checked: boolean) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;

  const wrap = document.createElement('label');
  wrap.className = `export-option${checked ? ' checked' : ''}`;
  const text = document.createElement('span');
  text.className = 'export-option-text';
  text.innerHTML =
    `<span class="export-option-label">${escapeHtml(label)}</span>` +
    `<span class="export-option-desc">${escapeHtml(desc)}</span>`;
  wrap.append(input, text);
  return { label: wrap, input };
}

// ===== 工具 =====

function checkedOptionCount(opts: ExportOptions): number {
  return [opts.includeJi, opts.includeChongSha, opts.includeZhiShen, opts.includeFarm, opts.includeReason]
    .filter(Boolean).length;
}

function triggerDownload(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function buildBaseName(d: Date, seq: number): string {
  // 序号保证同一份清单连续导出两次时文件名也能分出新旧
  return `吉日清单_${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}_${String(seq).padStart(3, '0')}`;
}

function formatDateTime(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function formatTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ===== 样式 =====

function injectExportStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* ---- 导出设置面板 ---- */
    .export-panel { margin-top: 20px; }

    .export-group { margin-bottom: 16px; }
    .export-group-label {
      font-weight: bold;
      color: var(--primary);
      margin-bottom: 10px;
      font-size: 14px;
    }

    .export-range-box {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .export-radio {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      cursor: pointer;
      background: #fff;
    }
    .export-radio.checked {
      border-color: var(--secondary);
      background: #f0f8f0;
    }
    .export-radio input { width: 18px; height: 18px; flex-shrink: 0; }
    .export-radio-text { display: flex; flex-direction: column; }
    .export-radio-label { font-size: 14px; font-weight: bold; }
    .export-radio-hint { font-size: 12px; color: var(--text-light); }

    .export-option-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }
    .export-option {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      cursor: pointer;
      background: #fff;
    }
    .export-option.checked {
      border-color: var(--secondary);
      background: #f0f8f0;
    }
    .export-option input { width: 18px; height: 18px; margin-top: 2px; flex-shrink: 0; }
    .export-option-text { display: flex; flex-direction: column; }
    .export-option-label { font-size: 14px; font-weight: bold; }
    .export-option-desc { font-size: 12px; color: var(--text-light); }
    .export-base-hint {
      margin-top: 10px;
      font-size: 12px;
      color: var(--text-light);
    }

    .export-count-hint {
      font-size: 13px;
      color: var(--secondary);
      margin-bottom: 10px;
    }
    .export-generate-btn {
      width: 100%;
      padding: 12px;
      background: var(--secondary);
      color: #fff;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 15px;
    }
    .export-generate-btn:disabled {
      background: #aaa;
      cursor: not-allowed;
    }

    .export-records { margin-top: 18px; display: flex; flex-direction: column; gap: 10px; }
    .export-records-title {
      font-size: 13px;
      font-weight: bold;
      color: var(--primary);
    }
    .export-record {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 14px;
      background: #fff;
    }
    .export-record-done { border-left: 4px solid var(--secondary); }
    .export-record-failed { border-left: 4px solid var(--accent); }
    .export-record-rendering { border-left: 4px solid #d4a017; }

    .export-record-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .export-record-title { font-size: 13px; font-weight: bold; }
    .export-status { font-size: 12px; white-space: nowrap; }
    .export-status-done { color: var(--secondary); }
    .export-status-failed { color: var(--accent); }
    .export-status-rendering { color: #b07d00; }

    .export-record-detail { font-size: 12px; color: var(--text-light); margin-top: 6px; }
    .export-record-error { font-size: 12px; color: var(--accent); margin-top: 6px; }

    .export-file-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-top: 6px;
      padding: 6px 10px;
      background: var(--card-bg);
      border-radius: 6px;
      font-size: 13px;
    }
    .export-file-link { color: var(--primary); text-decoration: none; word-break: break-all; }
    .export-file-link:hover { text-decoration: underline; }
    .export-file-size { color: var(--text-light); font-size: 12px; white-space: nowrap; }

    .export-retry-btn, .export-download-all-btn {
      margin-top: 10px;
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
    }
    .export-retry-btn {
      border: 1px solid var(--accent);
      background: #fff;
      color: var(--accent);
    }
    .export-download-all-btn {
      border: 1px solid var(--secondary);
      background: #fff;
      color: var(--secondary);
    }

    @media (max-width: 600px) {
      .export-option-grid, .export-range-box { grid-template-columns: 1fr; }
    }

    /* ---- 离屏渲染的导出图片 ---- */
    .exp-root {
      position: fixed;
      left: -99999px;
      top: 0;
      width: ${PAGE_W}px;
      background: ${BG};
      font-family: ${FONT_STACK};
      color: #333;
    }

    .exp-page {
      width: ${PAGE_W}px;
      height: ${PAGE_H}px;
      overflow: hidden;
      background: ${BG};
      box-sizing: border-box;
      padding: 40px 44px;
      display: flex;
      flex-direction: column;
      margin-bottom: 24px;
    }

    .exp-runhead {
      display: flex;
      justify-content: space-between;
      font-size: 20px;
      color: #9a8d76;
      padding-bottom: 14px;
      margin-bottom: 18px;
      border-bottom: 1px solid #e0d5c5;
      flex-shrink: 0;
    }

    .exp-title-block {
      text-align: center;
      margin-bottom: 22px;
      flex-shrink: 0;
    }
    .exp-title {
      font-size: 40px;
      font-weight: bold;
      color: #c41e3a;
      letter-spacing: 8px;
      margin-bottom: 10px;
    }
    .exp-subtitle { font-size: 21px; color: #8a7d66; margin-bottom: 8px; }
    .exp-meta-line { font-size: 20px; color: #6f6452; }

    .exp-body {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .exp-card {
      flex-shrink: 0;
      background: #fff;
      border-radius: 12px;
      padding: 18px 22px;
      border-left: 8px solid #d4a017;
      box-shadow: 0 2px 6px rgba(0,0,0,0.08);
    }
    .exp-score-best { border-left-color: #c41e3a; }

    .exp-card-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .exp-date { font-size: 28px; font-weight: bold; }
    .exp-score {
      font-size: 26px;
      font-weight: bold;
      color: #d4a017;
    }
    .exp-score-best .exp-score, .exp-card.exp-score-best .exp-score { color: #c41e3a; }

    .exp-ganzhi { font-size: 23px; color: #6f6452; margin-bottom: 8px; }

    .exp-row { font-size: 22px; color: #555; line-height: 1.5; }
    .exp-row-chong { color: #c41e3a; }
    .exp-row-farm { color: #2c5f2d; }
    .exp-row-reason { color: #8a7d66; font-size: 21px; }

    .exp-tags-row {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      font-size: 22px;
      line-height: 1.6;
    }
    .exp-tags-label {
      flex-shrink: 0;
      width: 36px;
      height: 36px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 22px;
      margin-top: 4px;
    }
    .exp-tags-label.is-yi { background: #e8f5e9; color: #2c5f2d; }
    .exp-tags-label.is-ji { background: #ffebee; color: #c41e3a; }
    .exp-tags { flex: 1; }
    .exp-tag { white-space: nowrap; }

    .exp-footer {
      margin-top: 18px;
      padding-top: 14px;
      border-top: 1px solid #e0d5c5;
      display: flex;
      justify-content: space-between;
      font-size: 20px;
      color: #9a8d76;
      flex-shrink: 0;
    }
  `;
  document.head.appendChild(style);
}
