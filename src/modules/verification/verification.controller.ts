import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { SuperAdmin } from '../auth/decorators';
import { GetUser } from '../common/decorators';
import { EntityAccess } from '../common/decorators/entity-access.decorator';
import { User } from '../users/entities';
import { VerificationReasonDto } from './dto/verification-reason.dto';
import { VerificationStatus } from './entities/entity-verification.entity';
import { VerificationService } from './verification.service';
import { SearchSync } from 'src/modules/search/decorators/search-sync.decorator';

@Controller('verification')
@ApiTags('Verification')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  // * ----------------------------------------------------------------------------------------------------------------
  // * ADMIN — queue + decisions (Binntu staff only: the seal is a Binntu-wide trust mark)
  // * ----------------------------------------------------------------------------------------------------------------

  @Get('admin/queue')
  @SuperAdmin()
  @ApiOperation({ summary: 'Verification requests by status (default: requested)' })
  @ApiQuery({ name: 'status', required: false, enum: ['requested', 'verified', 'rejected', 'revoked'] })
  findQueue(@Query('status') status?: VerificationStatus) {
    return this.verificationService.findQueue(status ?? 'requested');
  }

  @Post('admin/:entityType/:entityId/approve')
  @SearchSync('param:entityType', { param: 'entityId' })
  @SuperAdmin()
  @ApiOperation({ summary: 'Grant the Verified seal (every required document must be approved)' })
  approve(
    @Param('entityType') entityType: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @GetUser() user: User,
  ) {
    return this.verificationService.approve(entityType, entityId, user);
  }

  @Post('admin/:entityType/:entityId/reject')
  @SearchSync('param:entityType', { param: 'entityId' })
  @SuperAdmin()
  @ApiOperation({ summary: 'Decline a verification request' })
  reject(
    @Param('entityType') entityType: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Body() body: VerificationReasonDto,
    @GetUser() user: User,
  ) {
    return this.verificationService.reject(entityType, entityId, body.reason, user);
  }

  @Post('admin/:entityType/:entityId/revoke')
  @SearchSync('param:entityType', { param: 'entityId' })
  @SuperAdmin()
  @ApiOperation({ summary: 'Withdraw a granted Verified seal' })
  revoke(
    @Param('entityType') entityType: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Body() body: VerificationReasonDto,
    @GetUser() user: User,
  ) {
    return this.verificationService.revoke(entityType, entityId, body.reason, user);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * OWNER — state + request (owner, town-admin or super)
  // * ----------------------------------------------------------------------------------------------------------------

  @Get(':entityType/:entityId')
  @EntityAccess('manage', 'param:entityType', { param: 'entityId' })
  @ApiOperation({ summary: 'Verification state and required documents for a business' })
  getState(@Param('entityType') entityType: string, @Param('entityId', ParseUUIDPipe) entityId: string) {
    return this.verificationService.getState(entityType, entityId);
  }

  @Post(':entityType/:entityId/request')
  @EntityAccess('manage', 'param:entityType', { param: 'entityId' })
  @ApiOperation({ summary: 'Request the Verified seal (required documents must be uploaded)' })
  request(@Param('entityType') entityType: string, @Param('entityId', ParseUUIDPipe) entityId: string) {
    return this.verificationService.request(entityType, entityId);
  }
}
