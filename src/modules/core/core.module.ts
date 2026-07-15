import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppIcon, Badge, Category, EntityBadge, Facility, ImageResource, Language, Model, AppConfig } from './entities';
import {
  BadgesService,
  CategoriesService,
  FacilitiesService,
  LanguagesService,
  ModelsService,
  AppIconsService,
  AppConfigService,
} from './services';
import {
  BadgesController,
  CategoriesController,
  FacilitiesController,
  LanguagesController,
  ModelsController,
  AppIconsController,
  AppConfigController,
} from './controllers';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { TranslationsModule } from '../translations/translations.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Model,
      Facility,
      Category,
      ImageResource,
      Language,
      AppIcon,
      AppConfig,
      Badge,
      EntityBadge,
    ]),
    CloudinaryModule,
    TranslationsModule,
  ],
  controllers: [
    ModelsController,
    FacilitiesController,
    CategoriesController,
    LanguagesController,
    AppIconsController,
    AppConfigController,
    BadgesController,
  ],
  providers: [
    ModelsService,
    FacilitiesService,
    CategoriesService,
    LanguagesService,
    AppIconsService,
    AppConfigService,
    BadgesService,
  ],
})
export class CoreModule {}
