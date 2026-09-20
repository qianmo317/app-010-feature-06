import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FIELD_OPTIONS,
  ExportFieldOptions,
  bodyCapacity,
  buildExportFileName,
  dataUrlBytes,
  estimateCardHeight,
  estimatePageCount,
  formatBytes,
  formatDateLabel,
  paginate,
  selectResults,
} from './export';
import { PickResult } from '../almanac/pick-day';

function makeResult(i: number, overrides: Partial<PickResult> = {}): PickResult {
  const month = (i % 12) + 1;
  const day = (i % 27) + 1;
  return {
    year: 2025,
    month,
    day,
    score: 70,
    yi: ['祭祀', '祈福', '出行', '嫁娶'],
    ji: ['动土', '安葬'],
    ganZhi: '甲子',
    chong: '午',
    sha: '北',
    zhiShen: '青龙',
    reason: '吉日；宜嫁娶',
    ...overrides,
  };
}

const manyResults = (n: number) => Array.from({ length: n }, (_, i) => makeResult(i));

describe('selectResults 导出范围筛选', () => {
  const results = [
    makeResult(0, { score: 90 }),
    makeResult(1, { score: 70 }),
    makeResult(2, { score: 50 }),
    makeResult(3, { score: 30 }),
  ];

  it('best 只保留 80 分以上', () => {
    expect(selectResults(results, 'best').map((r) => r.score)).toEqual([90]);
  });

  it('good 保留 60 分以上', () => {
    expect(selectResults(results, 'good').map((r) => r.score)).toEqual([90, 70]);
  });

  it('all 保留全部', () => {
    expect(selectResults(results, 'all')).toHaveLength(4);
  });
});

describe('paginate 分页', () => {
  it('空列表返回空页数组', () => {
    expect(paginate([], DEFAULT_FIELD_OPTIONS)).toEqual([]);
    expect(estimatePageCount([], DEFAULT_FIELD_OPTIONS)).toBe(0);
  });

  it('少量结果只需一页', () => {
    expect(paginate(manyResults(2), DEFAULT_FIELD_OPTIONS)).toEqual([2]);
  });

  it('所有日期都被计入（卡片数总和等于日期数），卡片不跨页拆分', () => {
    const results = manyResults(100);
    const pages = paginate(results, DEFAULT_FIELD_OPTIONS);
    const cardPages = pages.filter((c) => c > 0);
    expect(cardPages.reduce((a, b) => a + b, 0)).toBe(100);
    // 每页卡片估算总高度不得超过页面容量
    pages.forEach((count, pageIndex) => {
      let start = 0;
      for (let i = 0; i < pageIndex; i++) start += pages[i];
      let used = 0;
      for (let j = 0; j < count; j++) {
        used += (j > 0 ? 14 : 0) + estimateCardHeight(results[start + j], DEFAULT_FIELD_OPTIONS);
      }
      expect(used).toBeLessThanOrEqual(bodyCapacity(pageIndex));
    });
  });

  it('仅含收尾行的页（计数 0）只能出现在最后一页', () => {
    const results = manyResults(100);
    const pages = paginate(results, DEFAULT_FIELD_OPTIONS);
    pages.forEach((count, index) => {
      if (index < pages.length - 1) expect(count).toBeGreaterThan(0);
    });
    expect(pages[pages.length - 1]).toBeGreaterThanOrEqual(0);
  });

  it('勾选项越少，页数不增加', () => {
    const results = manyResults(100);
    const full = estimatePageCount(results, DEFAULT_FIELD_OPTIONS);
    const minimal: ExportFieldOptions = {
      ganZhi: false, score: false, reason: false, yi: false, ji: false,
      chongSha: false, zhiShen: false, farm: false,
    };
    expect(estimatePageCount(results, minimal)).toBeLessThanOrEqual(full);
  });

  it('日期越多页数不减', () => {
    expect(estimatePageCount(manyResults(50), DEFAULT_FIELD_OPTIONS))
      .toBeLessThanOrEqual(estimatePageCount(manyResults(100), DEFAULT_FIELD_OPTIONS));
  });
});

describe('格式化工具', () => {
  it('formatDateLabel 补零', () => {
    expect(formatDateLabel(2025, 3, 6)).toBe('2025-03-06');
  });

  it('formatBytes 单位换算', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(1024 * 1024 * 1.5)).toBe('1.50 MB');
  });

  it('dataUrlBytes 计算 base64 解码大小', () => {
    // 'TQ==' 解码为 1 字节
    expect(dataUrlBytes('data:image/png;base64,TQ==')).toBe(1);
  });
});

describe('buildExportFileName 文件名', () => {
  const now = new Date(2025, 8, 20, 9, 5, 7); // 2025-09-20 09:05:07

  it('包含精确到秒的时间戳，单页不带页码', () => {
    expect(buildExportFileName(now, 1, 0)).toBe('吉日清单_20250920_090507');
  });

  it('多页带总页数', () => {
    expect(buildExportFileName(now, 3, 0)).toBe('吉日清单_20250920_090507_3页');
  });

  it('同一秒内重复导出加序号区分', () => {
    expect(buildExportFileName(now, 2, 1)).toBe('吉日清单_20250920_090507_2页_2');
    expect(buildExportFileName(now, 2, 2)).toBe('吉日清单_20250920_090507_2页_3');
  });
});
