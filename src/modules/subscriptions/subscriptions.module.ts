import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { Plan, PlanFeature, Subscription, Payment } from './entities';
import { PlansService, SubscriptionsService, PaymentsService, WompiService } from './services';
import {
  PlansController,
  AdminPlansController,
  SubscriptionsController,
  AdminSubscriptionsController,
  AdminPaymentsController,
  WebhooksController,
} from './controllers';
import { User } from '../users/entities';
import { UsersModule } from '../users/users.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Plan, PlanFeature, Subscription, Payment, User]),
    UsersModule,
    CommonModule,
  ],
  controllers: [
    PlansController,
    AdminPlansController,
    SubscriptionsController,
    AdminSubscriptionsController,
    AdminPaymentsController,
    WebhooksController,
  ],
  providers: [PlansService, SubscriptionsService, PaymentsService, WompiService],
  exports: [PlansService, SubscriptionsService, PaymentsService, WompiService],
})
export class SubscriptionsModule {}
