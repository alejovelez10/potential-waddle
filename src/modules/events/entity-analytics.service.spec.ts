// BIZ-08 / T-17-03..05: analytics math (conversion clamp, bot/internal exclusion, deltas vs
// prior window, empty-range zeros). The ownership/IDOR gate is unit-tested in
// src/modules/common/services/entity-ownership.resolver.spec.ts.
import { EntityAnalyticsService } from './entity-analytics.service';

// ------------------------------------------------------------------------------------------------
// EntityAnalyticsService — summary, conversion clamp, bot exclusion, deltas, empty range
// ------------------------------------------------------------------------------------------------
describe('EntityAnalyticsService (BIZ-01..05 — math)', () => {
  let service: EntityAnalyticsService;
  let dataSource: { query: jest.Mock };

  beforeEach(() => {
    dataSource = { query: jest.fn() };
    service = new EntityAnalyticsService(dataSource as any);
  });

  // The service runs several queries; we drive them by call order. The service implementation
  // must call, in order: (1) current-window aggregate, (2) previous-window aggregate,
  // (3) daily trend, (4) byCity, (5) byChannel, then the geo+tech breakdowns issued together via
  // Promise.all in array order: (6) byCountry, (7) byDepartment, (8) byDevice, (9) byBrowser,
  // (10) byOs. Each breakdown row is { key, visitors }. Each test stubs that sequence.
  const stub = (opts: {
    current: any;
    previous?: any;
    trend?: any[];
    byCity?: any[];
    byChannel?: any;
    byCountry?: any[];
    byDepartment?: any[];
    byDevice?: any[];
    byBrowser?: any[];
    byOs?: any[];
  }) => {
    dataSource.query
      .mockResolvedValueOnce([opts.current])
      .mockResolvedValueOnce([
        opts.previous ?? { views: '0', unique_visitors: '0', whatsapp_contacts: '0', converted_sessions: '0' },
      ])
      .mockResolvedValueOnce(opts.trend ?? [])
      .mockResolvedValueOnce(opts.byCity ?? [])
      .mockResolvedValueOnce([opts.byChannel ?? { whatsapp: '0', phone: '0', web: '0', map: '0', share: '0' }])
      .mockResolvedValueOnce(opts.byCountry ?? [])
      .mockResolvedValueOnce(opts.byDepartment ?? [])
      .mockResolvedValueOnce(opts.byDevice ?? [])
      .mockResolvedValueOnce(opts.byBrowser ?? [])
      .mockResolvedValueOnce(opts.byOs ?? []);
  };

  it('computes summary and clamps conversion <= 100 (same-session converted/unique)', async () => {
    // 2 unique visitors, 1 of them also sent a whatsapp -> 50%
    stub({ current: { views: '3', unique_visitors: '2', whatsapp_contacts: '1', converted_sessions: '1' } });
    const res = await service.getEntityAnalytics({ entityType: 'lodging', entityId: 'l-1', townId: 'town-1' });
    expect(res.summary.views).toBe(3);
    expect(res.summary.uniqueVisitors).toBe(2);
    expect(res.summary.whatsappContacts).toBe(1);
    expect(res.summary.conversionRate).toBe(50);
  });

  it('never lets conversion exceed 100% even with more contacts than visitors', async () => {
    // 1 visitor, 5 whatsapp contacts, but converted_sessions capped at unique -> <= 100
    stub({ current: { views: '1', unique_visitors: '1', whatsapp_contacts: '5', converted_sessions: '1' } });
    const res = await service.getEntityAnalytics({ entityType: 'lodging', entityId: 'l-1', townId: 'town-1' });
    expect(res.summary.conversionRate).toBeLessThanOrEqual(100);
    expect(res.summary.conversionRate).toBe(100);
  });

  it('empty range -> all zeros, conversion 0, deltas null (no NaN, no divide-by-zero)', async () => {
    stub({ current: { views: '0', unique_visitors: '0', whatsapp_contacts: '0', converted_sessions: '0' } });
    const res = await service.getEntityAnalytics({ entityType: 'lodging', entityId: 'l-1', townId: 'town-1' });
    expect(res.summary).toEqual({ views: 0, uniqueVisitors: 0, whatsappContacts: 0, conversionRate: 0 });
    expect(res.deltas.viewsPct).toBeNull();
    expect(res.deltas.uniqueVisitorsPct).toBeNull();
    expect(res.deltas.whatsappContactsPct).toBeNull();
    expect(Number.isNaN(res.summary.conversionRate)).toBe(false);
  });

  it('computes signed delta percentages vs the prior equal window', async () => {
    stub({
      current: { views: '120', unique_visitors: '60', whatsapp_contacts: '12', converted_sessions: '6' },
      previous: { views: '100', unique_visitors: '50', whatsapp_contacts: '10', converted_sessions: '5' },
    });
    const res = await service.getEntityAnalytics({ entityType: 'lodging', entityId: 'l-1', townId: 'town-1' });
    expect(res.deltas.viewsPct).toBe(20); // (120-100)/100 * 100
    expect(res.deltas.uniqueVisitorsPct).toBe(20);
    expect(res.deltas.whatsappContactsPct).toBe(20);
  });

  it('passes is_bot=false AND is_internal=false into every aggregate query (bot exclusion)', async () => {
    stub({ current: { views: '0', unique_visitors: '0', whatsapp_contacts: '0', converted_sessions: '0' } });
    await service.getEntityAnalytics({ entityType: 'lodging', entityId: 'l-1', townId: 'town-1' });
    for (const call of dataSource.query.mock.calls) {
      const sql = String(call[0]);
      expect(sql).toMatch(/is_bot\s*=\s*false/i);
      expect(sql).toMatch(/is_internal\s*=\s*false/i);
    }
  });

  it('returns trend, byCity and byChannel in the documented shape', async () => {
    stub({
      current: { views: '5', unique_visitors: '3', whatsapp_contacts: '1', converted_sessions: '1' },
      trend: [{ date: new Date('2026-06-20T00:00:00Z'), views: '5', contacts: '1' }],
      byCity: [
        { city: 'Medellín', visitors: '3' },
        { city: null, visitors: '1' },
      ],
      byChannel: { whatsapp: '1', phone: '2', web: '3', map: '4', share: '5' },
    });
    const res = await service.getEntityAnalytics({
      entityType: 'lodging',
      entityId: 'l-1',
      from: '2026-06-20',
      to: '2026-06-20',
      townId: 'town-1',
    });
    expect(res.trend.length).toBeGreaterThan(0);
    expect(res.trend[0]).toHaveProperty('date');
    expect(res.trend[0]).toHaveProperty('views');
    expect(res.trend[0]).toHaveProperty('contacts');
    expect(res.byCity[0]).toEqual({ city: 'Medellín', visitors: 3 });
    expect(res.byCity.find(c => c.city === 'Desconocida')).toBeDefined();
    expect(res.byChannel).toEqual({ whatsapp: 1, phone: 2, web: 3, map: 4, share: 5 });
  });

  it('returns geo + tech breakdowns with the correct Spanish null labels (quick 260624-n9q)', async () => {
    stub({
      current: { views: '5', unique_visitors: '3', whatsapp_contacts: '1', converted_sessions: '1' },
      byCountry: [
        { key: 'Colombia', visitors: '4' },
        { key: null, visitors: '1' },
      ],
      byDepartment: [
        { key: 'Antioquia', visitors: '3' },
        { key: null, visitors: '1' },
      ],
      byDevice: [
        { key: 'mobile', visitors: '3' },
        { key: null, visitors: '1' },
      ],
      byBrowser: [
        { key: 'Chrome', visitors: '2' },
        { key: null, visitors: '1' },
      ],
      byOs: [
        { key: 'Android', visitors: '2' },
        { key: null, visitors: '1' },
      ],
    });
    const res = await service.getEntityAnalytics({ entityType: 'lodging', entityId: 'l-1', townId: 'town-1' });

    expect(res.byCountry[0]).toEqual({ country: 'Colombia', visitors: 4 });
    expect(res.byCountry.find(c => c.country === 'Desconocido')).toBeDefined(); // masculine
    expect(res.byDepartment[0]).toEqual({ department: 'Antioquia', visitors: 3 });
    expect(res.byDepartment.find(d => d.department === 'Desconocida')).toBeDefined(); // feminine
    expect(res.byDevice[0]).toEqual({ device: 'mobile', visitors: 3 }); // raw value, UI maps to label
    expect(res.byDevice.find(d => d.device === 'Desconocido')).toBeDefined();
    expect(res.byBrowser[0]).toEqual({ browser: 'Chrome', visitors: 2 });
    expect(res.byOs[0]).toEqual({ os: 'Android', visitors: 2 });
  });

  it('returns per-channel daily clicks (channelTrend) from the same trend query', async () => {
    stub({
      current: { views: '9', unique_visitors: '4', whatsapp_contacts: '2', converted_sessions: '2' },
      trend: [
        {
          date: new Date('2026-06-20T00:00:00Z'),
          views: '9',
          contacts: '2',
          phone: '3',
          web: '1',
          map: '0',
          share: '4',
        },
      ],
    });
    const res = await service.getEntityAnalytics({
      entityType: 'lodging',
      entityId: 'l-1',
      from: '2026-06-20',
      to: '2026-06-20',
      townId: 'town-1',
    });
    expect(res.channelTrend.length).toBe(1);
    expect(res.channelTrend[0]).toEqual({
      date: '2026-06-20',
      whatsapp: 2, // contacts column = whatsapp_click
      phone: 3,
      web: 1,
      map: 0,
      share: 4,
    });
  });

  it('zero-fills channelTrend across every day in the range', async () => {
    stub({
      current: { views: '1', unique_visitors: '1', whatsapp_contacts: '1', converted_sessions: '0' },
      trend: [
        {
          date: new Date('2026-06-22T00:00:00Z'),
          views: '1',
          contacts: '1',
          phone: '0',
          web: '0',
          map: '0',
          share: '0',
        },
      ],
    });
    const res = await service.getEntityAnalytics({
      entityType: 'lodging',
      entityId: 'l-1',
      from: '2026-06-20',
      to: '2026-06-22',
      townId: 'town-1',
    });
    expect(res.channelTrend.map(p => p.date)).toEqual(['2026-06-20', '2026-06-21', '2026-06-22']);
    expect(res.channelTrend[0]).toEqual({ date: '2026-06-20', whatsapp: 0, phone: 0, web: 0, map: 0, share: 0 });
    expect(res.channelTrend[2].whatsapp).toBe(1);
  });

  it('empty range -> geo + tech breakdowns are empty arrays', async () => {
    stub({ current: { views: '0', unique_visitors: '0', whatsapp_contacts: '0', converted_sessions: '0' } });
    const res = await service.getEntityAnalytics({ entityType: 'lodging', entityId: 'l-1', townId: 'town-1' });
    expect(res.byCountry).toEqual([]);
    expect(res.byDepartment).toEqual([]);
    expect(res.byDevice).toEqual([]);
    expect(res.byBrowser).toEqual([]);
    expect(res.byOs).toEqual([]);
  });
});
