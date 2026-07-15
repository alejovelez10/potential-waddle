import { Module } from '@nestjs/common';
import { PlacesService } from './places.service';
import { PlacesController } from './places.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Place, PlaceImage } from './entities';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { Category, Facility, ImageResource } from '../core/entities';
import { ReviewsModule } from '../reviews/reviews.module';
import { TranslationsModule } from '../translations/translations.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Place, Category, Facility, ImageResource, PlaceImage]),
    CloudinaryModule,
    ReviewsModule,
    TranslationsModule,
  ],
  controllers: [PlacesController],
  providers: [PlacesService],
})
export class PlacesModule {}
