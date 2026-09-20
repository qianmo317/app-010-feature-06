// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderExportPanel, __resetExportCounterForTest } from './export';
import { pickDays } from '../almanac/pick-day';

vi.mock('html2canvas', () => ({
  default: vi.fn(),
}));

const meta = {
  events: ['嫁娶'],
  startDate: '2024-01-01',
  endDate: '2024-03-31',
  avoid: [] as string[],
};

function setup() {
  document.body.innerHTML = '<div id="container"></div>';
  const container = document.getElementById('container') as HTMLElement;
  const results = pickDays(2024, 1, 1, 2024, 3, 31, ['嫁娶']);
  renderExportPanel(container, results, meta);
  return { container, results };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetExportCounterForTest();
  // jsdom 没有真实的 canvas / 对象 URL / 下载
  URL.createObjectURL = vi.fn(() => 'blob:fake-url');
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});

describe('导出面板', () => {
  it('默认全选勾选项，并显示将导出的天数', () => {
    const { container } = setup();
    const checks = container.querySelectorAll('.export-option input');
    expect(checks.length).toBe(5);
    checks.forEach(c => expect((c as HTMLInputElement).checked).toBe(true));

    const hint = container.querySelector('.export-count-hint')?.textContent || '';
    expect(hint).toMatch(/将导出 \d+ 天/);
  });

  it('切换范围时更新数量与提示文案（大吉范围可能为空并禁用按钮）', () => {
    const { container } = setup();
    const radios = container.querySelectorAll('.export-radio input');

    // 切到“仅大吉”
    (radios[0] as HTMLInputElement).checked = true;
    radios[0].dispatchEvent(new Event('change'));
    const btn = container.querySelector('.export-generate-btn') as HTMLButtonElement;
    const hintBest = container.querySelector('.export-count-hint')?.textContent || '';
    if (/没有/.test(hintBest)) {
      expect(btn.disabled).toBe(true); // 空范围禁止导出
    } else {
      expect(hintBest).toMatch(/将导出 \d+ 天/);
      expect(btn.disabled).toBe(false);
    }

    // 切回“大吉与吉日”必然有数据
    (radios[1] as HTMLInputElement).checked = true;
    radios[1].dispatchEvent(new Event('change'));
    expect(container.querySelector('.export-count-hint')?.textContent).toMatch(/将导出 \d+ 天/);
    expect((container.querySelector('.export-generate-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('生成成功后显示记录、文件名、像素尺寸与大小，并自动触发下载', async () => {
    const { container } = setup();
    const html2canvas = (await import('html2canvas')).default as ReturnType<typeof vi.fn>;
    html2canvas.mockResolvedValue({
      toBlob: (cb: (b: Blob | null) => void) =>
        cb(new Blob([new Uint8Array(2048)], { type: 'image/png' })),
    });

    (container.querySelector('.export-generate-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(container.querySelectorAll('.export-record-done').length).toBe(1);
    });

    const detail = container.querySelector('.export-record-done .export-record-detail')?.textContent || '';
    expect(detail).toMatch(/1440×2160/);
    expect(detail).toMatch(/KB|MB/);

    const link = container.querySelector('.export-file-link') as HTMLAnchorElement;
    expect(link.download).toMatch(/^吉日清单_\d{8}_\d{6}_001(_p1)?\.png$/);

    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  it('生成失败时可重试，重试后成功且文件名序号更新', async () => {
    const { container } = setup();
    const html2canvas = (await import('html2canvas')).default as ReturnType<typeof vi.fn>;

    // 第一次渲染失败
    html2canvas.mockRejectedValueOnce(new Error('snapshot crashed'));
    (container.querySelector('.export-generate-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(container.querySelectorAll('.export-record-failed').length).toBe(1);
    });
    expect(container.querySelector('.export-record-error')?.textContent).toContain('snapshot crashed');

    // 重试成功
    html2canvas.mockResolvedValue({
      toBlob: (cb: (b: Blob | null) => void) =>
        cb(new Blob([new Uint8Array(1024)], { type: 'image/png' })),
    });
    (container.querySelector('.export-retry-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(container.querySelectorAll('.export-record-failed').length).toBe(0);
      expect(container.querySelectorAll('.export-record-done').length).toBe(1);
    });

    const link = container.querySelector('.export-file-link') as HTMLAnchorElement;
    // 重试是第二次生成，序号应为 002
    expect(link.download).toMatch(/_002/);
  });

  it('连续导出两次得到两份可区分新旧的记录与文件名', async () => {
    const { container } = setup();
    const html2canvas = (await import('html2canvas')).default as ReturnType<typeof vi.fn>;
    html2canvas.mockResolvedValue({
      toBlob: (cb: (b: Blob | null) => void) =>
        cb(new Blob([new Uint8Array(1024)], { type: 'image/png' })),
    });

    const btn = () => container.querySelector('.export-generate-btn') as HTMLButtonElement;
    btn().click();
    await vi.waitFor(() => expect(container.querySelectorAll('.export-record-done').length).toBe(1));

    btn().click();
    await vi.waitFor(() => expect(container.querySelectorAll('.export-record-done').length).toBe(2));

    const records = container.querySelectorAll('.export-record-done');
    expect(records.length).toBe(2);

    const firstName = (records[1].querySelector('.export-file-link') as HTMLAnchorElement).download;
    const secondName = (records[0].querySelector('.export-file-link') as HTMLAnchorElement).download;
    const seq1 = firstName.match(/_(\d{3})_p1\.png$/)?.[1];
    const seq2 = secondName.match(/_(\d{3})_p1\.png$/)?.[1];
    expect(seq1).toBe('001');
    expect(seq2).toBe('002');
    expect(firstName).not.toBe(secondName);

    // 每条记录都标注了页数与文件大小
    records.forEach(r => {
      expect(r.querySelector('.export-record-detail')?.textContent).toMatch(/共 \d+ 个图片文件/);
    });
  });
});
