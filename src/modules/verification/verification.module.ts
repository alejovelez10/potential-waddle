import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CommonModule } from '../common/common.module';
import { DocumentsModule } from '../documents/documents.module';
import { EntityVerification } from './entities/entity-verification.entity';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({
  imports: [TypeOrmModule.forFeature([EntityVerification]), CommonModule, DocumentsModule],
  controllers: [VerificationController],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}
