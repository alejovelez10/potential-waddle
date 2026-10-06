import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { GeoIpService } from './enrichment/geo-ip.service';
import { BotFilterService } from './enrichment/bot-filter.service';
import { DeviceParserService } from './enrichment/device-parser.service';
import { GeoipRefreshCron } from './geoip-refresh.cron';
import { EventsCanaryCron } from './events-canary.cron';
import { EntityAnalyticsService } from './entity-analytics.service';
import { CommonModule } from '../common/common.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PlatformAnalyticsService } from './platform-analytics.service';
import { Event } from './entities';
import { User } from '../users/entities';

@Module({
  // EntityAnalyticsService + EntityOwnershipResolver use the injected DataSource (raw SQL),
  // so no extra TypeOrmModule.forFeature entities are required for the read endpoint.
  imports: [TypeOrmModule.forFeature([Event, User]), CommonModule, SubscriptionsModule],
  controllers: [EventsController],
  providers: [
    EventsService,
    GeoIpService,
    BotFilterService,
    DeviceParserService,
    GeoipRefreshCron,
    EventsCanaryCron,
    EntityAnalyticsService,
    PlatformAnalyticsService,
  ],
  exports: [EventsService],
})
export class EventsModule {}
