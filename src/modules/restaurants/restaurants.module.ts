import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { VerificationModule } from '../verification/verification.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';

import { ImageResource, Category, Facility } from '../core/entities';
import { Restaurant, Menu } from './entities';
import { RestaurantsService } from './restaurants.service';
import { RestaurantsController } from './restaurants.controller';
import { MenuController } from './menu.controller';
import { MenuService } from './services/menu.service';
import { KmizenService } from './services/kmizen.service';
import { AnthropicMenuExtractionService } from './services/anthropic-menu-extraction.service';
import { MenuSweeperService } from './services/menu-sweeper.service';
import { RestaurantMenuAccessGuard } from './guards/restaurant-menu-access.guard';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { Town } from '../towns/entities';
import { User } from '../users/entities';
import { PromotionsModule } from '../promotions/promotions.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { TermsModule } from '../terms/terms.module';
import { DocumentsModule } from '../documents/documents.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TranslationsModule } from '../translations/translations.module';

@Module({
  controllers: [RestaurantsController, MenuController],
  providers: [
    RestaurantsService,
    MenuService,
    KmizenService,
    AnthropicMenuExtractionService,
    MenuSweeperService,
    RestaurantMenuAccessGuard,
  ],
  imports: [
    CommonModule,
    VerificationModule,
    TypeOrmModule.forFeature([Restaurant, ImageResource, Category, Facility, Town, User, Menu]),
    HttpModule,
    ConfigModule,
    CloudinaryModule,
    PromotionsModule,
    ReviewsModule,
    TermsModule,
    DocumentsModule,
    SubscriptionsModule,
    TranslationsModule,
  ],
})
export class RestaurantsModule {}
