import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { VerificationModule } from '../verification/verification.module';
import { TransportService } from './transport.service';
import { TransportController } from './transport.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transport } from './entities';
import { Category } from '../core/entities';
import { Town } from '../towns/entities';
import { User } from '../users/entities';
import { ReviewsModule } from '../reviews/reviews.module';
import { TermsModule } from '../terms/terms.module';
import { DocumentsModule } from '../documents/documents.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  controllers: [TransportController],
  providers: [TransportService],
  imports: [
    CommonModule,
    VerificationModule,
    TypeOrmModule.forFeature([Transport, Category, Town, User]),
    ReviewsModule,
    TermsModule,
    DocumentsModule,
    SubscriptionsModule,
  ],
})
export class TransportModule {}
