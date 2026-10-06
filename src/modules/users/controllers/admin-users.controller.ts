import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Body, Put } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SuperAdmin } from '../../auth/decorators';

import { SwaggerTags } from 'src/config';
import { GenericFindAllFilters } from 'src/modules/common/decorators';
import { UsersService } from '../services';
import { AdminUsersFiltersDto, AdminUsersListDto, AdminUserDto } from '../dto';
import { UserSortByEnum } from '../constants';
import { AdminUsersFiltersApiQueries } from '../decorators';

@Controller('admin/users')
@SuperAdmin()
@ApiTags(SwaggerTags.Users)
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Get all users with filters and pagination (Admin)' })
  @AdminUsersFiltersApiQueries()
  @ApiOkResponse({ description: 'Return paginated users list', type: AdminUsersListDto })
  findAll(@GenericFindAllFilters(AdminUsersFiltersDto, UserSortByEnum) filters: AdminUsersFiltersDto) {
    return this.usersService.findAllAdmin({ filters });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID (Admin)' })
  @ApiOkResponse({ description: 'Return user details', type: AdminUserDto })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.usersService.findOneAdmin(id);
  }

  @Patch(':id/toggle-active')
  @ApiOperation({ summary: 'Toggle user active status (Admin)' })
  @ApiOkResponse({ description: 'User status updated' })
  toggleActive(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.usersService.toggleActive(id);
  }

  @Patch(':id/toggle-super-user')
  @ApiOperation({ summary: 'Toggle user super user status (Admin)' })
  @ApiOkResponse({ description: 'User super user status updated' })
  toggleSuperUser(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.usersService.toggleSuperUser(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete user (Admin)' })
  @ApiOkResponse({ description: 'User deleted' })
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.usersService.remove(id);
  }

  @Get(':id/towns')
  @ApiOperation({ summary: 'Get user assigned towns (Admin)' })
  @ApiOkResponse({ description: 'Return user towns' })
  getUserTowns(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.usersService.getUserTowns(id);
  }

  @Put(':id/towns')
  @ApiOperation({ summary: 'Update user assigned towns (Admin)' })
  @ApiBody({ schema: { type: 'object', properties: { townIds: { type: 'array', items: { type: 'string' } } } } })
  @ApiOkResponse({ description: 'User towns updated' })
  updateUserTowns(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: { townIds: string[] }) {
    return this.usersService.updateUserTowns(id, body.townIds || []);
  }
}
