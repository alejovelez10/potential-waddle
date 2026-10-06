import { CommonModule } from '../common/common.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PublicEventsService } from './public-events.service';
import { PublicEventsController } from './public-events.controller';
import { PublicEvent, PublicEventImage } from './entities';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { ImageResource } from '../core/entities';
import { Town } from '../towns/entities';
import { User } from '../users/entities';

@Module({
  imports: [
    CommonModule,
    TypeOrmModule.forFeature([PublicEvent, PublicEventImage, ImageResource, Town, User]),
    CloudinaryModule,
  ],
  controllers: [PublicEventsController],
  providers: [PublicEventsService],
  exports: [PublicEventsService],
})
export class PublicEventsModule {}
