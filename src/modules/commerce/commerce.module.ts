import { Module } from '@nestjs/common';
import { CommerceService } from './commerce.service';
import { CommerceController } from './commerce.controller';
import { Commerce, CommerceProduct, CommerceProductImage } from './entities';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImageResource } from '../core/entities';
import { Facility } from '../core/entities';
import { Category } from '../core/entities';
import { User } from '../users/entities';
import { Town } from '../towns/entities';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { CommerceProductsService } from './commerce-products.service';
import { CommerceProductsController } from './commerce-products.controller';
import { ReviewsModule } from '../reviews/reviews.module';
import { TermsModule } from '../terms/terms.module';
import { DocumentsModule } from '../documents/documents.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TranslationsModule } from '../translations/translations.module';

@Module({
  controllers: [CommerceController, CommerceProductsController],
  providers: [CommerceService, CommerceProductsService],
  imports: [
    TypeOrmModule.forFeature([
      Commerce,
      CommerceProduct,
      CommerceProductImage,
      ImageResource,
      Category,
      Facility,
      Town,
      User,
    ]),
    CloudinaryModule,
    ReviewsModule,
    TermsModule,
    DocumentsModule,
    SubscriptionsModule,
    TranslationsModule,
  ],
})
export class CommerceModule {}
