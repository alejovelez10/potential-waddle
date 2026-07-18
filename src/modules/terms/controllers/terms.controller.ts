import { Body, Controller, Get, Headers, Ip, Param, ParseEnumPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { Auth, OptionalAuth } from 'src/modules/auth/decorators';
import { GetUser } from 'src/modules/common/decorators';
import { User } from 'src/modules/users/entities';
import { SwaggerTags } from 'src/config';
import { RequestLocale } from 'src/modules/translations/request-locale.decorator';

import { TermsService } from '../services';
import { TermsTypeEnum } from '../interfaces';
import { AcceptTermsDto, TermsDocumentDto, TermsStatusDto } from '../dto';

@Controller('terms')
@ApiTags(SwaggerTags.Terms)
export class TermsController {
  constructor(private readonly termsService: TermsService) {}

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ACTIVE T&C DOCUMENT BY TYPE (public; optional auth)
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('active')
  @OptionalAuth()
  @ApiOperation({ summary: 'Get active T&C document by type' })
  @ApiQuery({ name: 'type', enum: TermsTypeEnum })
  @ApiOkResponse({ description: 'Active T&C document for the requested type', type: TermsDocumentDto })
  findActive(
    @Query('type', new ParseEnumPipe(TermsTypeEnum)) type: TermsTypeEnum,
    @RequestLocale() locale: string,
  ) {
    return this.termsService.findActive(type, locale);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * RECORD USER ACCEPTANCE (auth required; server captures IP/UA)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post(':id/accept')
  @Auth()
  @ApiOperation({ summary: 'Record user acceptance of a T&C document (idempotent)' })
  @ApiOkResponse({
    description: 'Acceptance record (new or existing if idempotent replay)',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: '624013aa-9555-4a69-bf08-30cf990c56dd' },
        acceptedAt: { type: 'string', example: '2026-04-24T00:00:00.000Z' },
      },
    },
  })
  accept(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptTermsDto,
    @GetUser() user: User,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.termsService.accept({
      termsId: id,
      user,
      context: dto.context,
      ip,
      userAgent,
    });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET CURRENT USER STATUS (auth required)
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('me/status')
  @Auth()
  @ApiOperation({ summary: "Get current user's T&C acceptance status" })
  @ApiOkResponse({ description: 'Map of which active T&C docs the user has accepted', type: TermsStatusDto })
  getMyStatus(@GetUser() user: User) {
    return this.termsService.getStatusForUser(user.id);
  }
}
