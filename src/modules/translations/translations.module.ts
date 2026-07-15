import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EntityTranslation } from './entities/entity-translation.entity';
import { TranslationResolverService } from './translation-resolver.service';

@Module({
  imports: [TypeOrmModule.forFeature([EntityTranslation])],
  providers: [TranslationResolverService],
  exports: [TranslationResolverService],
})
export class TranslationsModule {}
