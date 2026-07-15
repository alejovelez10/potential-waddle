import { Column, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'entity_translation' }) // SINGULAR table name (matches codebase convention)
@Index(['entityType', 'entityId', 'locale']) // lookup index — batchLoad query key (D-04 Claude's Discretion)
@Unique(['entityType', 'entityId', 'field', 'locale']) // D-04 uniqueness constraint
export class EntityTranslation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { name: 'entity_type', length: 50 })
  entityType: string; // 'lodging' | 'restaurant' | 'roomType' | 'category' | 'facility' | ... (D-06: sub-items are their own entity_type)

  @Column('uuid', { name: 'entity_id' })
  entityId: string;

  @Column('varchar', { length: 100 })
  field: string; // 'description' | 'howToGetThere' | 'name' (D-01: name IS storable, just not auto-seeded) | 'biography' | ...

  @Column('varchar', { length: 10 })
  locale: string; // 'en', 'fr'... NEVER 'es' (es is canonical, never stored — Pitfall 2)

  @Column('text')
  value: string;

  @Column('varchar', { length: 20, default: 'auto' })
  source: 'auto' | 'revisado'; // D-05 — exists for Phase 28; do NOT build seed/override here

  @Column('varchar', { name: 'source_hash', length: 64, nullable: true })
  sourceHash: string | null; // D-07 sha256 of ES source — exists for Phase 28 staleness

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
