import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';

import {
  ChatConversation,
  ChatMessage,
  KnowledgeSource,
  KnowledgeSourceSyncLog,
  Skill,
  SkillAllowedTool,
  SkillResource,
  Tool,
} from './entities';
import { RafaAdminController } from './rafa-admin.controller';
import { RafaAdminService } from './rafa-admin.service';

/**
 * Rafa AI agent module (NEW — isolated from the legacy `src/modules/rafa/`,
 * which is NOT touched or reused per D-06/D-09).
 *
 * Phase 1 scope: register the 8 mono-tenant entities so they compile to
 * `dist/**​/*.entity.js` and are discovered by the migration data source.
 * Controllers/DTOs (the management API) land in Phase 5 (ADMIN-01).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChatConversation,
      ChatMessage,
      Tool,
      Skill,
      SkillResource,
      SkillAllowedTool,
      KnowledgeSource,
      KnowledgeSourceSyncLog,
    ]),
    // HttpModule powers the rafa-sync proxy hop (nest → rafa /internal/sync).
    // ConfigModule is global (app.module isGlobal: true) so it needs no import here.
    HttpModule,
  ],
  controllers: [RafaAdminController],
  providers: [RafaAdminService],
})
export class RafaAiAgentModule {}
