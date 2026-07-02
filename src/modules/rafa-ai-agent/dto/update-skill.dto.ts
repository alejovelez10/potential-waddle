import { PartialType } from '@nestjs/swagger';
import { CreateSkillDto } from './create-skill.dto';

/**
 * PATCH payload for a skill: every CreateSkillDto field becomes optional
 * (and keeps its class-validator rules — including the unbounded `body`).
 */
export class UpdateSkillDto extends PartialType(CreateSkillDto) {}
