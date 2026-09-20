// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mock html2canvas：记录传入的页面 DOM，返回固定字节数的 data URL
const mockCaptures: HTMLElement[] = [];
let mockShouldFail = false;
const mockPngBase64 = 'A'.repeat(4096); // 3072 字节 → 显示 3.0 KB

vi.mock('html2canvas', () => ({
  default: vi.fn(async (el: HTMLElement) => {
    if (mockShouldFail) throw new Error('mock 渲染失败');
    mockCaptures.push(el);
    return {
      toDataURL: () => `data:image/png;base64,${mockPngBase64}`,
    };
  }),
}));

import html2canvas from 'html2canvas';
import { createExportPanel } from './export-image';
import { pickDays } from '../almanac/pick-day';

// 两个月数据，足以产生多页
const results = pickDays(2025, 3, 1, 2025, 4, 30, ['嫁娶', '出行']);

function mountPanel() {
  document.body.innerHTML = '';
  mockCaptures.length = 0;
  mockShouldFail = false;
  const panel = createExportPanel(results);
  document.body.appendChild(panel);
  panel.hidden = false;
  return panel;
}


function setCheckbox(panel: HTMLElement, field: string, checked: boolean) {
  const input = panel.querySelector(`input[data-field="${field}"]`) as HTMLInputElement;
  input.checked = checked;
  input.dispatchEvent(new Event('change'));
}

function setScope(panel: HTMLElement, value: string) {
  const input = panel.querySelector(`input[value="${value}"]`) as HTMLInputElement;
  input.checked = true;
  input.dispatchEvent(new Event('change'));
}

async function clickGenerate(panel: HTMLElement) {
  (panel.querySelector('.generate-btn') as HTMLButtonElement).click();
  // 等待内部 async 循环（含 sleep(150)）完成
  await vi.waitFor(() => {
    const state = panel.querySelector('.export-run .run-state')?.textContent || '';
    expect(state.startsWith('已完成') || state.startsWith('部分失败')).toBe(true);
  }, { timeout: 5000 });
}

describe('导出设置面板', () => {
  beforeEach(() => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('初始显示默认范围天数与预计页数，范围切换实时更新', () => {
    const panel = mountPanel();
    const preview = panel.querySelector('.export-preview') as HTMLElement;
    expect(preview.textContent).toContain('将导出');
    expect(preview.textContent).toMatch(/约 \d+ 页/);

    const bestCount = results.filter((r) => r.score >= 80).length;
    const bestLabel = panel.querySelector('input[value="best"]')!.closest('.export-check')!;
    expect(bestLabel.querySelector('.scope-count')!.textContent).toBe(`${bestCount} 天`);

    setScope(panel, 'all');
    expect(preview.textContent).toContain(`${results.length} 个日期`);
  });

  it('范围为空时禁用生成按钮并提示', () => {
    const panel = mountPanel();
    const btn = panel.querySelector('.generate-btn') as HTMLButtonElement;
    // best 范围在本数据集里可能为空；若不为空，改用一个全低分的空数据集
    const bestEmpty = results.every((r) => r.score < 80);
    if (bestEmpty) {
      setScope(panel, 'best');
      expect(btn.disabled).toBe(true);
      expect(panel.querySelector('.export-preview')!.textContent).toContain('暂无可导出');
    } else {
      const emptyPanel = createExportPanel(results.map((r) => ({ ...r, score: 10 })));
      document.body.appendChild(emptyPanel);
      emptyPanel.hidden = false;
      expect((emptyPanel.querySelector('.generate-btn') as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('完整导出：每页 720×1080、卡片不跨页、末页有收尾、文件名带大小且互不重复', async () => {
    const panel = mountPanel();
    await clickGenerate(panel);

    const expectedPages = Number((panel.querySelector('.export-preview')!.textContent!).match(/约 (\d+) 页/)![1]);
    expect(expectedPages).toBeGreaterThan(1);
    expect(mockCaptures).toHaveLength(expectedPages);

    // 每页尺寸固定、边距一致（jsdom 会规范化 style 文本，用正则与计算样式断言）
    mockCaptures.forEach((pageEl, i) => {
      const style = pageEl.getAttribute('style')!;
      expect(style).toMatch(/width:\s*720px/);
      expect(style).toMatch(/height:\s*1080px/);
      const cs = getComputedStyle(pageEl);
      expect(cs.paddingTop).toBe('28px');
      expect(cs.paddingBottom).toBe('28px');
      expect(cs.paddingLeft).toBe('32px');
      expect(cs.paddingRight).toBe('32px');
      // 每页卡片完整且不为空
      const cards = pageEl.querySelectorAll(':scope > div:nth-child(2) > div');
      expect(cards.length).toBeGreaterThan(0);
      // 页脚页码正确
      const footer = pageEl.querySelector(':scope > div:last-child') as HTMLElement;
      expect(footer.textContent).toContain(`第 ${i + 1} / ${expectedPages} 页`);
    });

    // 首页标题含范围与总数，续页有“续”标记
    expect(mockCaptures[0].textContent).toContain('择日吉日清单');
    expect(mockCaptures[0].textContent).toContain(`共 ${results.filter((r) => r.score >= 60).length} 个日期`);
    expect(mockCaptures[1].textContent).toContain('续');

    // 所有日期在卡片区域恰好出现一次（页脚的本页日期范围不计入）
    const cardText = mockCaptures
      .map((el) => Array.from(el.querySelectorAll(':scope > div:nth-child(2) > div'), (c) => c.textContent || ''))
      .flat()
      .join('\n');
    const good = results.filter((r) => r.score >= 60);
    good.forEach((r) => {
      const label = `${r.year}-${String(r.month).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`;
      expect(cardText.split(label).length - 1).toBe(1);
    });

    // 每张卡片都包含勾选的忌、冲煞、值神、农事（有数据时）
    const firstCard = mockCaptures[0].querySelector(':scope > div:nth-child(2) > div') as HTMLElement;
    expect(firstCard.textContent).toMatch(/宜/);
    expect(firstCard.textContent).toMatch(/忌/);
    expect(firstCard.textContent).toMatch(/冲.+煞/);
    expect(firstCard.textContent).toMatch(/值神：/);
    expect(firstCard.textContent).toMatch(/农事 · /);

    // 末页有“清单完”收尾行与总日期数
    const last = mockCaptures[mockCaptures.length - 1];
    expect(last.textContent).toContain('清单完');
    expect(last.textContent).toContain(`共 ${good.length} 个日期`);

    // 结果列表：文件名 + 可读大小
    const rows = panel.querySelectorAll('.export-file.done');
    expect(rows).toHaveLength(expectedPages);
    const names = new Set<string>();
    rows.forEach((row) => {
      const name = row.querySelector('.file-name')!.textContent!;
      const size = row.querySelector('.file-size')!.textContent!;
      expect(name).toMatch(/^吉日清单_\d{8}_\d{6}_\d+页_第\d+页\.png$/);
      expect(size).toBe('3.0 KB');
      names.add(name);
    });
    // 每页文件名各不相同
    expect(names.size).toBe(expectedPages);
    // 最后一页文件名页码正确
    const lastName = panel.querySelector('.export-run:last-child .export-file:last-child .file-name')!.textContent!;
    expect(lastName).toContain(`_第${expectedPages}页.png`);

    expect(html2canvas).toHaveBeenCalledTimes(expectedPages);
  });

  it('同一份清单连续导出两次：两组文件名整体可区分（跨秒按时间戳，同秒加序号）', async () => {
    const panel = mountPanel();
    await clickGenerate(panel);
    await clickGenerate(panel);

    expect(panel.querySelectorAll('.export-run')).toHaveLength(2);
    const firstRunNames = Array.from(
      panel.querySelectorAll('.export-run:last-child .file-name')
    ).map((n) => n.textContent);
    const secondRunNames = Array.from(
      panel.querySelectorAll('.export-run:first-child .file-name')
    ).map((n) => n.textContent);

    const allNames = [...firstRunNames, ...secondRunNames];
    expect(new Set(allNames).size).toBe(allNames.length);
    // 两次导出的文件名不应完全相同
    expect(secondRunNames[0]).not.toBe(firstRunNames[0]);
    // 同秒序号规则已在 export.test.ts 的 buildExportFileName 中覆盖
  });

  it('取消勾选字段后，卡片不再包含该内容', async () => {
    const panel = mountPanel();
    setCheckbox(panel, 'ji', false);
    setCheckbox(panel, 'farm', false);
    setCheckbox(panel, 'chongSha', false);
    setCheckbox(panel, 'zhiShen', false);
    await clickGenerate(panel);

    const firstCard = mockCaptures[0].querySelector(':scope > div:nth-child(2) > div') as HTMLElement;
    expect(firstCard.textContent).not.toMatch(/忌/);
    expect(firstCard.textContent).not.toContain('农事');
    expect(firstCard.textContent).not.toMatch(/冲.+煞/);
    expect(firstCard.textContent).not.toContain('值神');
    // 仍保留日期、干支、宜、分数
    expect(firstCard.textContent).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(firstCard.textContent).toMatch(/\d+分/);
    expect(firstCard.textContent).toMatch(/[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]日/);
    expect(firstCard.textContent).toMatch(/宜/);
  });

  it('失败页显示错误并可重试，成功后文件名与大小正常', async () => {
    const panel = mountPanel();
    mockShouldFail = true;
    await clickGenerate(panel);

    const failedRows = panel.querySelectorAll('.export-file.failed');
    expect(failedRows.length).toBeGreaterThan(0);
    expect(panel.querySelector('.retry-all-btn')).toBeTruthy();
    expect(panel.querySelector('.run-state')!.textContent).toContain('部分失败');

    // 恢复成功，重试全部失败页
    mockShouldFail = false;
    (panel.querySelector('.retry-all-btn') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      const state = panel.querySelector('.export-run .run-state')?.textContent || '';
      expect(state).toContain('已完成');
    }, { timeout: 5000 });

    expect(panel.querySelectorAll('.export-file.failed')).toHaveLength(0);
    expect(panel.querySelectorAll('.export-file.done').length).toBeGreaterThan(0);
    expect(panel.querySelector('.export-file.done .file-size')!.textContent).toBe('3.0 KB');
  });
});
