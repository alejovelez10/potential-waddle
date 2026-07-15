import { Module } from '@nestjs/common';
import { ExperiencesService } from './experiences.service';
import { ExperiencesController } from './experiences.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Experience } from './entities';
import { Category } from '../core/entities';
import { Facility } from '../core/entities';
import { ImageResource } from '../core/entities';
import { Guide } from '../guides/entities/guide.entity';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { Town } from '../towns/entities';
import { PromotionsModule } from '../promotions/promotions.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { TermsModule } from '../terms/terms.module';
import { DocumentsModule } from '../documents/documents.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TranslationsModule } from '../translations/translations.module';

@Module({
  controllers: [ExperiencesController],
  providers: [ExperiencesService],
  imports: [
    TypeOrmModule.forFeature([Experience, ImageResource, Facility, Category, Guide, Town]),
    CloudinaryModule,
    PromotionsModule,
    ReviewsModule,
    TermsModule,
    DocumentsModule,
    SubscriptionsModule,
    TranslationsModule,
  ],
})
export class ExperiencesModule {}
