import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
// import { ScheduleModule } from '@nestjs/schedule'; // crons OFF por ahora (ver más abajo)
import { appConfig, JoiValidationSchema, typeOrmConfig } from './config';
import { AuthModule } from './modules/auth/auth.module';
import { CommonModule } from './modules/common/common.module';
import { CloudinaryModule } from './modules/cloudinary/cloudinary.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { TownsModule } from './modules/towns/towns.module';
import { CoreModule } from './modules/core/core.module';
import { PlacesModule } from './modules/places/places.module';
import { SeedsModule } from './modules/seeds/seeds.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { LodgingsModule } from './modules/lodgings/lodgings.module';
import { ExperiencesModule } from './modules/experiences/experiences.module';
import { RestaurantsModule } from './modules/restaurants/restaurants.module';
import { TinifyModule } from './modules/tinify/tinify.module';
import { TransportModule } from './modules/transport/transport.module';
import { CommerceModule } from './modules/commerce/commerce.module';
import { GuidesModule } from './modules/guides/guides.module';
import { GooglePlacesModule } from './modules/google-places/google-places.module';
import { HomeModule } from './modules/home/home.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { PublicEventsModule } from './modules/public-events/public-events.module';
import { WhatsappClicksModule } from './modules/whatsapp-clicks/whatsapp-clicks.module';
import { EventsModule } from './modules/events/events.module';
import { MapModule } from './modules/map/map.module';
import { EmailModule } from './modules/email/email.module';
import { TurnstileModule } from './modules/turnstile/turnstile.module';
import { PineconeModule } from './modules/pinecone/pinecone.module';
import { RafaModule } from './modules/rafa/rafa.module';
import { RafaAiAgentModule } from './modules/rafa-ai-agent/rafa-ai-agent.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { TenantInterceptor } from './modules/tenant/tenant.interceptor';
import { DocumentsModule } from './modules/documents/documents.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { TermsModule } from './modules/terms/terms.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ForcedPublicModule } from './modules/forced-public/forced-public.module';
import { TranslationsModule } from './modules/translations/translations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [appConfig],
      validationSchema: JoiValidationSchema,
      isGlobal: true,
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: typeOrmConfig,
    }),

    // Cron jobs desactivados por ahora (decisión 2026-07-19): sin ScheduleModule.forRoot()
    // ningún @Cron se agenda ni dispara (menu-sweeper, events-canary, geoip-refresh,
    // google-sync, google-reconciliation, translation-sweep). Reactivar = descomentar.
    // ScheduleModule.forRoot(),

    CommonModule,
    EmailModule,
    TurnstileModule,
    AuthModule,
    UsersModule,
    RolesModule,
    CloudinaryModule,
    TownsModule,
    CoreModule,
    PlacesModule,
    SeedsModule,
    ReviewsModule,
    LodgingsModule,
    ExperiencesModule,
    RestaurantsModule,
    TinifyModule,
    TransportModule,
    CommerceModule,
    GuidesModule,
    GooglePlacesModule,
    HomeModule,
    PromotionsModule,
    PublicEventsModule,
    WhatsappClicksModule,
    EventsModule,
    MapModule,
    PineconeModule,
    RafaModule,
    RafaAiAgentModule,
    DashboardModule,
    TenantModule,
    DocumentsModule,
    SubscriptionsModule,
    AnalyticsModule,
    TermsModule,
    NotificationsModule,
    ForcedPublicModule,
    TranslationsModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantInterceptor,
    },
  ],
})
export class AppModule {}
