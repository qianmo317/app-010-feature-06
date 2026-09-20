import { router } from '../router';
import { createElement, clearElement } from '../utils/dom';
import { pickDays, categorizeResults, PickResult } from '../almanac/pick-day';
import { EVENT_WEIGHTS } from '../almanac/yiji';
import { renderExportPanel, ExportMeta } from './export';

export function renderPick(app: HTMLElement) {
  clearElement(app);
  app.className = 'page pick-page';

  const now = new Date();
  const defaultStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const defaultEnd = `${now.getFullYear() + 1}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // 头部
  const header = createElement('div', 'page-header');
  const backBtn = createElement('button', 'back-btn', '◀ 返回');
  backBtn.addEventListener('click', () => router.navigate('/'));
  const title = createElement('h1', 'page-title', '择日向导');
  header.append(backBtn, title);

  // 表单
  const form = createElement('div', 'pick-form');

  // 事项选择
  const eventsSection = createElement('div', 'form-section');
  eventsSection.innerHTML = '<label>选择事项（可多选）</label>';
  const eventsGrid = createElement('div', 'events-grid');
  const selectedEvents = new Set<string>();

  Object.keys(EVENT_WEIGHTS).forEach(event => {
    const btn = createElement('button', 'event-btn', event);
    btn.addEventListener('click', () => {
      if (selectedEvents.has(event)) {
        selectedEvents.delete(event);
        btn.classList.remove('selected');
      } else {
        selectedEvents.add(event);
        btn.classList.add('selected');
      }
    });
    eventsGrid.appendChild(btn);
  });
  eventsSection.appendChild(eventsGrid);

  // 日期范围
  const dateSection = createElement('div', 'form-section');
  dateSection.innerHTML = `
    <label>日期范围</label>
    <div class="date-range">
      <input type="date" id="start-date" value="${defaultStart}">
      <span>至</span>
      <input type="date" id="end-date" value="${defaultEnd}">
    </div>
  `;

  // 避讳
  const avoidSection = createElement('div', 'form-section');
  avoidSection.innerHTML = `
    <label>避讳生肖（可选，多选用逗号分隔）</label>
    <input type="text" id="avoid-shengxiao" placeholder="如：鼠,马,鸡">
  `;

  // 提交按钮
  const submitBtn = createElement('button', 'submit-btn', '开始择日');

  form.append(eventsSection, dateSection, avoidSection, submitBtn);

  // 结果区域
  const resultArea = createElement('div', 'result-area');

  submitBtn.addEventListener('click', () => {
    if (selectedEvents.size === 0) {
      alert('请至少选择一个事项');
      return;
    }

    const startDate = (document.getElementById('start-date') as HTMLInputElement).value;
    const endDate = (document.getElementById('end-date') as HTMLInputElement).value;
    const avoidInput = (document.getElementById('avoid-shengxiao') as HTMLInputElement).value;
    const avoidShengxiao = avoidInput.split(/[,，]/).map(s => s.trim()).filter(Boolean);

    const [sy, sm, sd] = startDate.split('-').map(Number);
    const [ey, em, ed] = endDate.split('-').map(Number);

    const startTime = performance.now();
    const results = pickDays(sy, sm, sd, ey, em, ed, Array.from(selectedEvents), avoidShengxiao);
    const endTime = performance.now();

    const exportMeta: ExportMeta = {
      events: Array.from(selectedEvents),
      startDate,
      endDate,
      avoid: avoidShengxiao,
    };
    renderResults(resultArea, results, endTime - startTime, exportMeta);
  });

  app.append(header, form, resultArea);
}

function renderResults(container: HTMLElement, results: PickResult[], elapsed: number, meta: ExportMeta) {
  clearElement(container);

  const { best, good, normal, bad } = categorizeResults(results);

  const stats = createElement('div', 'result-stats');
  stats.innerHTML = `
    <span>大吉 ${best.length} 天</span>
    <span>吉 ${good.length} 天</span>
    <span>平 ${normal.length} 天</span>
    <span>凶 ${bad.length} 天</span>
    <span class="elapsed">计算耗时 ${elapsed.toFixed(1)}ms</span>
  `;
  container.appendChild(stats);

  // 最佳日期
  if (best.length > 0) {
    const bestSection = createElement('div', 'result-section');
    bestSection.innerHTML = '<h3 class="section-title best">大吉之日</h3>';
    const grid = createElement('div', 'result-grid');
    best.forEach(r => grid.appendChild(createResultCard(r)));
    bestSection.appendChild(grid);
    container.appendChild(bestSection);
  }

  // 吉日
  if (good.length > 0) {
    const goodSection = createElement('div', 'result-section');
    goodSection.innerHTML = '<h3 class="section-title good">吉日</h3>';
    const grid = createElement('div', 'result-grid');
    good.slice(0, 20).forEach(r => grid.appendChild(createResultCard(r)));
    goodSection.appendChild(grid);
    container.appendChild(goodSection);
  }

  // 导出面板（勾选内容、分页排版、文件名与大小、失败重试）
  renderExportPanel(container, results, meta);
}

function createResultCard(result: PickResult): HTMLElement {
  const card = createElement('div', `result-card score-${Math.floor(result.score / 20)}`);
  card.innerHTML = `
    <div class="result-date">${result.year}-${String(result.month).padStart(2, '0')}-${String(result.day).padStart(2, '0')}</div>
    <div class="result-ganzhi">${result.ganZhi}日</div>
    <div class="result-score">${result.score}分</div>
    <div class="result-reason">${result.reason}</div>
    <div class="result-yi">${result.yi.slice(0, 4).map(y => `<span>${y}</span>`).join('')}</div>
  `;
  card.addEventListener('click', () => {
    router.navigate(`/day/${result.year}-${String(result.month).padStart(2, '0')}-${String(result.day).padStart(2, '0')}`);
  });
  return card;
}

