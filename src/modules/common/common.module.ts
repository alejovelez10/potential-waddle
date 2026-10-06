import { Module } from '@nestjs/common';
import { DistributedLockService } from './services/distributed-lock.service';
import { EntityOwnershipResolver } from './services/entity-ownership.resolver';
import { EntityAccessGuard } from './guards/entity-access.guard';

@Module({
  controllers: [],
  providers: [DistributedLockService, EntityOwnershipResolver, EntityAccessGuard],
  exports: [DistributedLockService, EntityOwnershipResolver, EntityAccessGuard],
})
export class CommonModule {}
