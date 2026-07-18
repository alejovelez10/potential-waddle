import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '../users/entities';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { TranslationsModule } from '../translations/translations.module';

import { TermsDocument, TermsAcceptance } from './entities';
import { TermsService } from './services';
import { TermsController, AdminTermsController } from './controllers';

@Module({
  imports: [
    TypeOrmModule.forFeature([TermsDocument, TermsAcceptance, User]),
    CloudinaryModule,
    // TranslationResolverService for the locale-overlay in findActive (quick 260718-ka1)
    TranslationsModule,
  ],
  controllers: [TermsController, AdminTermsController],
  providers: [TermsService],
  exports: [TermsService],
})
export class TermsModule {}
