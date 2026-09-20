import html2canvas from 'html2canvas';
import { PickResult } from '../almanac/pick-day';
import {
  DEFAULT_FIELD_OPTIONS,
  ExportFieldOptions,
  ExportOptions,
  ExportScope,
  PAGE,
  buildExportFileName,
  chongShengxiao,
  dataUrlBytes,
  estimatePageCount,
  formatBytes,
  formatDateLabel,
  getFarmTipFor,
  paginate,
  selectResults,
} from './export';

interface ExportedFile {
  pageIndex: number;
  fileName: string;
  bytes: number;
  dataUrl: string;
  status: 'done' | 'failed';
  error?: string;
}

interface RunGroup {
  id: number;
  startedAt: Date;
  baseName: string;
  scopeLabel: string;
  selected: PickResult[];
  counts: number[];
  fields: ExportFieldOptions;
  files: ExportedFile[];
  generating: boolean;
}

const FIELD_LABELS: Array<{ key: keyof ExportFieldOptions; label: string }> = [
  { key: 'ganZhi', label: '干支' },
  { key: 'score', label: '评分' },
  { key: 'reason', label: '推荐理由' },
  { key: 'yi', label: '宜（事项）' },
  { key: 'ji', label: '忌（事项）' },
  { key: 'chongSha', label: '冲煞' },
  { key: 'zhiShen', label: '值神' },
  { key: 'farm', label: '农事提示' },
];

const SCOPE_OPTIONS: Array<{ value: ExportScope; label: string }> = [
  { value: 'best', label: '大吉之日（≥80分）' },
  { value: 'good', label: '吉日及以上（≥60分）' },
  { value: 'all', label: '全部日期' },
];

const FONT_STACK = '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", serif';
const COLORS = {
  bg: '#f7f3e9',
  accent: '#c41e3a',
  best: '#c41e3a',
  good: '#d4a017',
  normal: '#7a7a7a',
  text: '#333333',
  light: '#888888',
  border: '#e3d8c5',
  cardBg: '#ffffff',
  yiBg: '#e8f5e9',
  yiText: '#2c5f2d',
  jiBg: '#ffebee',
  jiText: '#c41e3a',
};

let runSeq = 0;
let lastFileNameStamp = '';
let sameSecondSeq = 0;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 创建导出设置面板
export function createExportPanel(allResults: PickResult[]): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'export-panel card';
  panel.hidden = true;
  panel.innerHTML = `
    <h3>导出吉日清单</h3>
    <div class="export-row">
      <span class="export-row-label">导出范围</span>
      <div class="export-opt-group" data-group="scope"></div>
    </div>
    <div class="export-row">
      <span class="export-row-label">包含内容</span>
      <div class="export-opt-group export-checkboxes" data-group="fields">
        <label class="export-check static"><input type="checkbox" checked disabled> 日期</label>
      </div>
    </div>
    <div class="export-preview"></div>
    <div class="export-actions">
      <button type="button" class="generate-btn">生成图片</button>
      <span class="generate-hint"></span>
    </div>
    <div class="export-progress" hidden></div>
    <div class="export-history"></div>
  `;

  const scopeGroup = panel.querySelector('[data-group="scope"]') as HTMLElement;
  const fieldsGroup = panel.querySelector('[data-group="fields"]') as HTMLElement;
  const preview = panel.querySelector('.export-preview') as HTMLElement;
  const generateBtn = panel.querySelector('.generate-btn') as HTMLButtonElement;
  const hint = panel.querySelector('.generate-hint') as HTMLElement;
  const progress = panel.querySelector('.export-progress') as HTMLElement;
  const history = panel.querySelector('.export-history') as HTMLElement;

  SCOPE_OPTIONS.forEach((opt) => {
    const label = document.createElement('label');
    label.className = 'export-check';
    label.innerHTML = `<input type="radio" name="export-scope" value="${opt.value}"> <span>${opt.label}</span><em class="scope-count"></em>`;
    (label.querySelector('input') as HTMLInputElement).checked = opt.value === 'good';
    scopeGroup.appendChild(label);
  });

  FIELD_LABELS.forEach(({ key, label: text }) => {
    const label = document.createElement('label');
    label.className = 'export-check';
    label.innerHTML = `<input type="checkbox" data-field="${key}" ${DEFAULT_FIELD_OPTIONS[key] ? 'checked' : ''}> <span>${text}</span>`;
    fieldsGroup.appendChild(label);
  });

  function readOptions(): ExportOptions {
    const scope = (scopeGroup.querySelector('input:checked') as HTMLInputElement).value as ExportScope;
    const fields = { ...DEFAULT_FIELD_OPTIONS };
    fieldsGroup.querySelectorAll('input[data-field]').forEach((input) => {
      const el = input as HTMLInputElement;
      fields[el.dataset.field as keyof ExportFieldOptions] = el.checked;
    });
    return { scope, fields };
  }

  function refreshPreview() {
    const { scope, fields } = readOptions();
    const selected = selectResults(allResults, scope);
    scopeGroup.querySelectorAll('.export-check').forEach((label) => {
      const el = label as HTMLElement;
      const value = (el.querySelector('input') as HTMLInputElement).value as ExportScope;
      const count = selectResults(allResults, value).length;
      (el.querySelector('.scope-count') as HTMLElement).textContent = `${count} 天`;
    });
    if (selected.length === 0) {
      preview.textContent = '该范围内暂无可导出的日期，请调整范围或择日条件。';
      preview.className = 'export-preview warn';
      generateBtn.disabled = true;
    } else {
      const pages = estimatePageCount(selected, fields);
      preview.textContent = `将导出 ${selected.length} 个日期，预计约 ${pages} 页（固定 720×1080 版式，字号适合手机查看，日期不会被截断）`;
      preview.className = 'export-preview';
      generateBtn.disabled = false;
    }
  }

  panel.querySelectorAll('input').forEach((input) => input.addEventListener('change', refreshPreview));
  refreshPreview();

  const groups: RunGroup[] = [];

  function renderHistory() {
    clearNode(history);
    groups.forEach((group) => {
      const done = group.files.filter((f) => f.status === 'done').length;
      const failed = group.files.filter((f) => f.status === 'failed').length;
      const stateText = group.generating
        ? `生成中…（${done + failed}/${group.counts.length}）`
        : failed > 0
          ? `部分失败（成功 ${done} 页，失败 ${failed} 页）`
          : `已完成（${done} 页）`;

      const runEl = document.createElement('div');
      runEl.className = `export-run ${group.generating ? 'running' : failed > 0 ? 'has-failed' : 'done'}`;
      runEl.innerHTML = `
        <div class="export-run-head">
          <strong>第 ${group.id} 次导出</strong>
          <span class="run-meta">${group.startedAt.toLocaleString('zh-CN')} · ${group.scopeLabel} · ${group.selected.length} 个日期 · ${group.counts.length} 页</span>
          <span class="run-state">${stateText}</span>
        </div>
        <ul class="export-files"></ul>
      `;
      const list = runEl.querySelector('.export-files') as HTMLElement;

      group.files.forEach((file) => {
        const li = document.createElement('li');
        li.className = `export-file ${file.status}`;
        if (file.status === 'done') {
          li.innerHTML = `
            <span class="file-name">${file.fileName}</span>
            <span class="file-size">${formatBytes(file.bytes)}</span>
            <a class="file-save" href="${file.dataUrl}" download="${file.fileName}">另存</a>
          `;
        } else {
          li.innerHTML = `
            <span class="file-name">${file.fileName}</span>
            <span class="file-error">生成失败${file.error ? `：${escapeHtml(file.error)}` : ''}</span>
            <button type="button" class="file-retry">重试</button>
          `;
          li.querySelector('.file-retry')!.addEventListener('click', () => {
            void retryPage(group, file, li);
          });
        }
        list.appendChild(li);
      });

      if (failed > 0 && !group.generating) {
        const retryAll = document.createElement('button');
        retryAll.type = 'button';
        retryAll.className = 'retry-all-btn';
        retryAll.textContent = `重试 ${failed} 个失败页`;
        retryAll.addEventListener('click', () => {
          void retryFailed(group);
        });
        runEl.appendChild(retryAll);
      }
      history.appendChild(runEl);
    });
  }

  async function capturePage(group: RunGroup, pageIndex: number): Promise<ExportedFile> {
    const total = group.counts.length;
    const fileName = total > 1
      ? `${group.baseName}_第${pageIndex + 1}页.png`
      : `${group.baseName}.png`;

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:720px;';
    const pageEl = buildPage(group, pageIndex);
    host.appendChild(pageEl);
    document.body.appendChild(host);

    try {
      const canvas = await html2canvas(pageEl, {
        scale: 3,
        useCORS: true,
        backgroundColor: COLORS.bg,
        logging: false,
        width: PAGE.WIDTH,
        height: PAGE.HEIGHT,
        windowWidth: PAGE.WIDTH,
      });
      const dataUrl = canvas.toDataURL('image/png');
      triggerDownload(dataUrl, fileName);
      return { pageIndex, fileName, bytes: dataUrlBytes(dataUrl), dataUrl, status: 'done' };
    } catch (err) {
      return { pageIndex, fileName, bytes: 0, dataUrl: '', status: 'failed', error: err instanceof Error ? err.message : String(err) };
    } finally {
      document.body.removeChild(host);
    }
  }

  function startProgress(text: string) {
    progress.hidden = false;
    progress.textContent = text;
  }

  async function runPages(group: RunGroup, indices: number[]) {
    group.generating = true;
    renderHistory();
    for (const idx of indices) {
      startProgress(`正在生成第 ${idx + 1} / ${group.counts.length} 页，请稍候…`);
      const result = await capturePage(group, idx);
      const existing = group.files.find((f) => f.pageIndex === idx);
      if (existing) {
        Object.assign(existing, result);
      } else {
        group.files.push(result);
      }
      renderHistory();
      if (result.status === 'done') await sleep(150); // 错开下载，减少浏览器拦截
    }
    group.generating = false;
    group.files.sort((a, b) => a.pageIndex - b.pageIndex);
    const failed = group.files.filter((f) => f.status === 'failed').length;
    progress.textContent = failed > 0
      ? `生成结束：${group.files.length - failed} 页成功，${failed} 页失败，可点击下方"重试"。若浏览器只保存了部分图片，可逐页点"另存"。`
      : `全部 ${group.files.length} 页已生成并开始下载；如浏览器拦截了批量下载，可在下方逐页点"另存"。`;
    renderHistory();
  }

  async function retryPage(group: RunGroup, file: ExportedFile, li: HTMLElement) {
    li.classList.add('retrying');
    li.querySelector('.file-retry')!.textContent = '重试中…';
    (li.querySelector('.file-retry') as HTMLButtonElement).disabled = true;
    const result = await capturePage(group, file.pageIndex);
    Object.assign(file, result);
    renderHistory();
  }

  async function retryFailed(group: RunGroup) {
    const indices = group.files.filter((f) => f.status === 'failed').map((f) => f.pageIndex);
    await runPages(group, indices);
  }

  generateBtn.addEventListener('click', () => {
    const options = readOptions();
    const selected = selectResults(allResults, options.scope);
    if (selected.length === 0) return;

    const counts = paginate(selected, options.fields);
    if (counts.length > 60 && !window.confirm(`预计生成 ${counts.length} 页图片，浏览器可能拦截批量下载，是否继续？`)) {
      return;
    }

    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    if (stamp === lastFileNameStamp) {
      sameSecondSeq++;
    } else {
      lastFileNameStamp = stamp;
      sameSecondSeq = 0;
    }

    const scopeLabel = SCOPE_OPTIONS.find((s) => s.value === options.scope)!.label;
    const group: RunGroup = {
      id: ++runSeq,
      startedAt: now,
      baseName: buildExportFileName(now, counts.length, sameSecondSeq),
      scopeLabel,
      selected,
      counts,
      fields: options.fields,
      files: [],
      generating: true,
    };
    groups.unshift(group);
    generateBtn.disabled = true;
    hint.textContent = '';
    void runPages(group, counts.map((_, i) => i)).finally(() => {
      generateBtn.disabled = false;
    });
  });

  return panel;
}

function clearNode(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function triggerDownload(dataUrl: string, fileName: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// 构建某一页的 DOM
function buildPage(group: RunGroup, pageIndex: number): HTMLElement {
  const total = group.counts.length;
  const page = document.createElement('div');
  page.style.cssText = `
    width:${PAGE.WIDTH}px;height:${PAGE.HEIGHT}px;
    background:${COLORS.bg};padding:${PAGE.PADDING_TOP}px ${PAGE.PADDING_X}px ${PAGE.PADDING_BOTTOM}px;
    font-family:${FONT_STACK};color:${COLORS.text};
    display:flex;flex-direction:column;overflow:hidden;position:relative;
  `;
  page.appendChild(buildHeader(group, pageIndex));

  const body = document.createElement('div');
  body.style.cssText = `flex:1;display:flex;flex-direction:column;gap:${PAGE.CARD_GAP}px;margin:16px 0;min-height:0;`;

  let start = 0;
  for (let i = 0; i < pageIndex; i++) start += group.counts[i];
  const slice = group.selected.slice(start, start + group.counts[pageIndex]);
  slice.forEach((r) => body.appendChild(buildCard(r, group.fields)));

  const isLast = pageIndex === total - 1;
  if (isLast) {
    const endNote = document.createElement('div');
    endNote.style.cssText = 'margin-top:auto;padding-top:12px;border-top:1px solid ' + COLORS.border + ';text-align:center;font-size:14px;color:' + COLORS.light + ';';
    endNote.textContent = `—— 清单完 · 共 ${group.selected.length} 个日期 ——`;
    body.appendChild(endNote);
  }

  page.appendChild(body);
  page.appendChild(buildFooter(group, pageIndex, slice));
  return page;
}

// 头部（首页 / 续页）
function buildHeader(group: RunGroup, pageIndex: number): HTMLElement {
  const header = document.createElement('div');
  if (pageIndex === 0) {
    const nowText = group.startedAt.toLocaleString('zh-CN', { hour12: false });
    header.style.cssText = 'position:relative;text-align:center;';
    header.innerHTML = `
      <div style="font-size:26px;font-weight:bold;color:${COLORS.accent};letter-spacing:6px;line-height:1.3;">择日吉日清单</div>
      <div style="font-size:14px;color:${COLORS.light};margin-top:8px;line-height:1.5;">
        ${group.scopeLabel} · 共 ${group.selected.length} 个日期 · ${escapeHtml(nowText)} · 共 ${group.counts.length} 页
      </div>
      <div style="position:absolute;top:0;right:0;width:52px;height:52px;border:2px solid ${COLORS.accent};border-radius:6px;display:flex;align-items:center;justify-content:center;color:${COLORS.accent};font-size:15px;font-weight:bold;transform:rotate(-12deg);opacity:0.85;">大吉</div>
    `;
  } else {
    header.style.cssText = `display:flex;justify-content:space-between;align-items:baseline;padding-bottom:8px;border-bottom:1px solid ${COLORS.border};`;
    header.innerHTML = `
      <span style="font-size:15px;color:${COLORS.light};">择日吉日清单（续）</span>
      <span style="font-size:14px;color:${COLORS.light};">第 ${pageIndex + 1} / ${group.counts.length} 页</span>
    `;
  }
  return header;
}

// 页脚
function buildFooter(group: RunGroup, pageIndex: number, slice: PickResult[]): HTMLElement {
  const footer = document.createElement('div');
  footer.style.cssText = `display:flex;justify-content:space-between;font-size:13px;color:${COLORS.light};padding-top:8px;border-top:1px solid ${COLORS.border};`;
  let rangeText = '—';
  if (slice.length > 0) {
    const first = formatDateLabel(slice[0].year, slice[0].month, slice[0].day);
    const last = formatDateLabel(slice[slice.length - 1].year, slice[slice.length - 1].month, slice[slice.length - 1].day);
    rangeText = slice.length === 1 ? first : `${first} ~ ${last}`;
  }
  footer.innerHTML = `<span>老黄历择日 · 仅供参考</span><span>第 ${pageIndex + 1} / ${group.counts.length} 页 · ${rangeText}</span>`;
  return footer;
}

// 单个吉日卡片
function buildCard(r: PickResult, fields: ExportFieldOptions): HTMLElement {
  const color = r.score >= 80 ? COLORS.best : r.score >= 60 ? COLORS.good : COLORS.normal;
  const card = document.createElement('div');
  card.style.cssText = `
    background:${COLORS.cardBg};border-radius:10px;padding:${PAGE.CARD_PADDING}px;
    border-left:4px solid ${color};box-shadow:0 1px 3px rgba(0,0,0,0.08);
    flex-shrink:0;
  `;

  const parts: string[] = [];

  // 日期行（恒有）
  const scorePart = fields.score
    ? `<span style="font-size:20px;color:${color};font-weight:bold;">${r.score}分</span>`
    : '';
  parts.push(`
    <div style="display:flex;justify-content:space-between;align-items:baseline;">
      <span style="font-size:21px;font-weight:bold;">${formatDateLabel(r.year, r.month, r.day)}</span>
      ${scorePart}
    </div>
  `);

  const metaLines: string[] = [];
  if (fields.ganZhi) metaLines.push(`${r.ganZhi}日`);
  if (fields.reason && r.reason) metaLines.push(escapeHtml(r.reason));
  if (metaLines.length > 0) {
    parts.push(`<div style="font-size:15px;color:#666;line-height:1.6;">${metaLines.join(' · ')}</div>`);
  }

  if (fields.yi && r.yi.length > 0) {
    parts.push(buildChipRow('宜', r.yi, COLORS.yiBg, COLORS.yiText));
  }
  if (fields.ji && r.ji.length > 0) {
    parts.push(buildChipRow('忌', r.ji, COLORS.jiBg, COLORS.jiText));
  }

  const meta: string[] = [];
  if (fields.chongSha) {
    meta.push(`冲${r.chong}（${chongShengxiao(r.chong)}）煞${r.sha}`);
  }
  if (fields.zhiShen) meta.push(`值神：${r.zhiShen}`);
  if (meta.length > 0) {
    parts.push(`<div style="font-size:14px;color:#777;line-height:1.6;">${meta.join(' · ')}</div>`);
  }

  if (fields.farm) {
    const tip = getFarmTipFor(r);
    if (tip) {
      parts.push(`
        <div style="border-top:1px dashed ${COLORS.border};padding-top:8px;font-size:13px;color:#555;line-height:1.6;">
          <span style="color:#1565c0;font-weight:bold;">农事 · ${escapeHtml(tip.term)}</span>
          ：${escapeHtml(tip.tasks.join('、'))}
        </div>
      `);
    }
  }

  card.innerHTML = parts.join('<div style="height:8px;"></div>');
  return card;
}

function buildChipRow(label: string, items: string[], bg: string, color: string): string {
  const chips = items.map((item) =>
    `<span style="display:inline-block;padding:3px 9px;border-radius:4px;background:${bg};color:${color};font-size:14px;line-height:1.5;margin:0 6px 6px 0;">${escapeHtml(item)}</span>`
  ).join('');
  return `
    <div style="font-size:14px;line-height:1.6;">
      <span style="font-weight:bold;color:${color};margin-right:6px;">${label}</span>${chips}
    </div>
  `;
}
