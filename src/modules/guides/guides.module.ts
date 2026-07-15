import { Module } from '@nestjs/common';
import { GuidesService } from './guides.service';
import { GuidesController } from './guides.controller';
import { User } from '../users/entities';
import { Town } from '../towns/entities';
import { Category } from '../core/entities';
import { Guide } from './entities/guide.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GuideImage } from './entities/guide-image.entity';
import { ImageResource } from '../core/entities';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { TermsModule } from '../terms/terms.module';
import { DocumentsModule } from '../documents/documents.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TranslationsModule } from '../translations/translations.module';

@Module({
  controllers: [GuidesController],
  providers: [GuidesService],
  imports: [
    TypeOrmModule.forFeature([Guide, Category, Town, User, ImageResource, GuideImage]),
    CloudinaryModule,
    ReviewsModule,
    TermsModule,
    DocumentsModule,
    SubscriptionsModule,
    TranslationsModule,
  ],
})
export class GuidesModule {}
