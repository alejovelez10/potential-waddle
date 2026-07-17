import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EntityTranslation } from './entities/entity-translation.entity';

@Injectable()
export class TranslationResolverService {
  constructor(
    @InjectRepository(EntityTranslation)
    private readonly repo: Repository<EntityTranslation>,
  ) {}

  /**
   * Batch-load translations for N entities in ONE query (N+1 guard).
   * locale='es' → early-exit with empty Map, zero DB calls (Pitfall 2: es is canonical, never stored).
   * empty ids → early-exit with empty Map, zero DB calls.
   */
  async batchLoad(entityType: string, ids: string[], locale: string): Promise<Map<string, Record<string, string>>> {
    if (!ids.length || locale === 'es') return new Map();

    const rows = await this.repo.find({
      where: { entityType, entityId: In(ids), locale },
      select: ['entityId', 'field', 'value'],
    });

    const map = new Map<string, Record<string, string>>();
    for (const row of rows) {
      if (!map.has(row.entityId)) map.set(row.entityId, {});
      map.get(row.entityId)![row.field] = row.value;
    }
    return map;
  }

  /**
   * Load translations for a single entity.
   * locale='es' → early-exit returning empty object, zero DB calls.
   */
  async load(entityType: string, id: string, locale: string): Promise<Record<string, string>> {
    if (locale === 'es') return {};

    const rows = await this.repo.find({
      where: { entityType, entityId: id, locale },
      select: ['field', 'value'],
    });

    return Object.fromEntries(rows.map((r) => [r.field, r.value]));
  }

  /**
   * Overlay translations onto a base entity object.
   * - Creates a shallow copy (does NOT mutate the original — Pitfall 5).
   * - Fallback to es is implicit: fields without a translation keep their base (es) value.
   * - Only overlays fields that already exist on the base object.
   */
  overlay<T extends Record<string, unknown>>(entity: T, translations: Record<string, string>): T {
    const out = { ...entity } as Record<string, unknown>;
    for (const [field, value] of Object.entries(translations)) {
      if (field in out) out[field] = value;
    }
    return out as T;
  }

  /**
   * Overlay de traducciones sobre cada item de una colección (relaciones anidadas
   * tipo categories/facilities). Reutiliza el overlay shallow por item sobre una copia
   * — ni el array ni los objetos originales se mutan (Pitfall 5). Items sin fila en el
   * Map conservan su valor base (es) — fallback implícito.
   */
  overlayCollection<T extends { id: string }>(items: T[], translationsMap: Map<string, Record<string, string>>): T[] {
    return items.map(
      (item) =>
        this.overlay({ ...item } as unknown as Record<string, unknown>, translationsMap.get(item.id) ?? {}) as unknown as T,
    );
  }
}
