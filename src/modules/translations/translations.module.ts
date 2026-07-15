import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EntityTranslation } from './entities/entity-translation.entity';

@Module({
  imports: [TypeOrmModule.forFeature([EntityTranslation])],
  // TranslationResolverService added + exported in Plan 02
})
export class TranslationsModule {}
