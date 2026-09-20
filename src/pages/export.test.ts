import { describe, it, expect } from 'vitest';
import { pickDays } from '../almanac/pick-day';
import type { PickResult } from '../almanac/pick-day';
import {
  paginateByHeights,
  estimateCardHeight,
  buildBaseName,
  formatSize,
} from '../pages/export';
import type { ExportOptions } from '../pages/export';

const FULL_OPTIONS: ExportOptions = {
  range: 'good',
  includeJi: true,
  includeChongSha: true,
  includeZhiShen: true,
  includeFarm: true,
  includeReason: true,
};

function sampleResults(): PickResult[] {
  return pickDays(2024, 1, 1, 2024, 12, 31, ['嫁娶', '搬家']);
}

describe('导出分页', () => {
  it('所有卡片都落在某一页，且区间连续不重不漏', () => {
    const days = sampleResults().filter(r => r.score >= 60);
    const heights = days.map(d => estimateCardHeight(d, FULL_OPTIONS));
    const pages = paginateByHeights(heights);

    expect(pages.length).toBeGreaterThan(1); // 一年的吉日应当多页
    expect(pages[0][0]).toBe(0);
    expect(pages[pages.length - 1][1]).toBe(days.length);
    for (let i = 1; i < pages.length; i++) {
      expect(pages[i][0]).toBe(pages[i - 1][1]);
    }
  });

  it('每页内容不超过正文容量（含卡片间距），即卡片不会被截断', () => {
    const days = sampleResults().filter(r => r.score >= 60);
    const heights = days.map(d => estimateCardHeight(d, FULL_OPTIONS));
    const [firstCap, otherCap, gap] = [720, 906, 18];

    const pages = paginateByHeights(heights, firstCap, otherCap, gap);
    pages.forEach(([s, e], i) => {
      const used = heights.slice(s, e).reduce((sum, h, idx) => sum + h + (idx > 0 ? gap : 0), 0);
      expect(used).toBeLessThanOrEqual(i === 0 ? firstCap : otherCap);
    });
  });

  it('第一页容量小于后续页（为标题块预留空间），但边距体系一致', () => {
    const pages = paginateByHeights(new Array(60).fill(200), 720, 906, 18);
    // 第一页: floor((720+18)/(200+18)) = 3 张 (3*200+2*18=636<=720, 4 张=836>720)
    expect(pages[0][1] - pages[0][0]).toBe(3);
    // 后续页: 4 张 (4*200+3*18=854<=906)
    expect(pages[1][1] - pages[1][0]).toBe(4);
  });

  it('单卡超过整页时独占一页而不是死循环或丢卡', () => {
    const pages = paginateByHeights([9999, 200, 200], 720, 906, 18);
    expect(pages).toEqual([[0, 1], [1, 3]]);
  });

  it('空清单不产生页面', () => {
    expect(paginateByHeights([])).toEqual([]);
  });
});

describe('勾选内容影响卡片高度', () => {
  const day = sampleResults().filter(r => r.score >= 60)[0];

  it('全选比全不选高（忌/冲煞/值神/农事/理由都占位）', () => {
    const none: ExportOptions = {
      range: 'good',
      includeJi: false,
      includeChongSha: false,
      includeZhiShen: false,
      includeFarm: false,
      includeReason: false,
    };
    expect(estimateCardHeight(day, FULL_OPTIONS)).toBeGreaterThan(estimateCardHeight(day, none));
  });

  it('勾选项越少，同一清单需要的页数越少或相等', () => {
    const days = sampleResults().filter(r => r.score >= 60);
    const none: ExportOptions = {
      range: 'good',
      includeJi: false,
      includeChongSha: false,
      includeZhiShen: false,
      includeFarm: false,
      includeReason: false,
    };
    const fullPages = paginateByHeights(days.map(d => estimateCardHeight(d, FULL_OPTIONS))).length;
    const nonePages = paginateByHeights(days.map(d => estimateCardHeight(d, none))).length;
    expect(nonePages).toBeLessThanOrEqual(fullPages);
  });
});

describe('导出文件名与大小', () => {
  it('同秒连续两次导出，文件名靠序号也能分出新旧', () => {
    const d = new Date(2024, 5, 6, 7, 8, 9); // 2024-06-06 07:08:09
    expect(buildBaseName(d, 1)).toBe('吉日清单_20240606_070809_001');
    expect(buildBaseName(d, 2)).toBe('吉日清单_20240606_070809_002');
  });

  it('多页文件名为序号分页', () => {
    const base = buildBaseName(new Date(2024, 0, 1), 3);
    expect(`${base}_p1.png`).toMatch(/^吉日清单_\d{8}_\d{6}_003_p1\.png$/);
  });

  it('大小按 KB/MB 友好显示', () => {
    expect(formatSize(0)).toBe('1 KB');
    expect(formatSize(1024)).toBe('1 KB');
    expect(formatSize(1536)).toBe('2 KB');
    expect(formatSize(1024 * 1024)).toBe('1.00 MB');
    expect(formatSize(1536 * 1024)).toBe('1.50 MB');
  });
});
