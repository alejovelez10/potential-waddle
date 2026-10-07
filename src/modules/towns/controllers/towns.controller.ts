import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ForbiddenException,
  Put,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { TownsService, TownImagesService } from '../services';
import { CreateTownDto } from '../dto/create-town.dto';
import { UpdateTownDto } from '../dto/update-town.dto';
import { AdminTownsFiltersDto } from '../dto/admin-towns-filters.dto';
import { UpdateTownImageDto, SetHeroImagesDto } from '../dto/town-image.dto';
import { ReorderImagesDto } from 'src/modules/common/dto/reoder-images.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { SwaggerTags } from 'src/config';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { GetUser } from 'src/modules/common/decorators/get-user.decorator';
import { User } from 'src/modules/users/entities/user.entity';
import { UsersService } from 'src/modules/users/services/users.service';
import { SuperAdmin } from '../../auth/decorators';
import { SearchSync, SearchSyncSkip } from 'src/modules/search/decorators/search-sync.decorator';

// Search sync: only the update routes change catalog data (town name/slug); see method-level @SearchSync.
@SearchSyncSkip()
@Controller('towns')
@ApiTags(SwaggerTags.Town)
export class TownsController {
  constructor(
    private readonly townsService: TownsService,
    private readonly townImagesService: TownImagesService,
    private readonly usersService: UsersService,
  ) {}

  private async getUserTownIds(user: User): Promise<string[]> {
    const fullUser = await this.usersService.getFullUser(user.email);
    return fullUser?.towns?.map(t => t.id) ?? [];
  }

  private async assertCanManageTown(user: User, townId: string): Promise<void> {
    if (user.isSuperUser) return;
    const ids = await this.getUserTownIds(user);
    if (!ids.includes(townId)) {
      throw new ForbiddenException('No tienes permisos para gestionar este municipio');
    }
  }

  // ============================================================================
  // ADMIN ENDPOINTS
  // ============================================================================

  @Get('admin/list')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get paginated towns list (Admin only)' })
  async findAllAdmin(@Query() filters: AdminTownsFiltersDto, @GetUser() user: User) {
    if (user.isSuperUser) return this.townsService.findAllPaginated(filters);
    const townIds = await this.getUserTownIds(user);
    return this.townsService.findAllPaginated({ ...filters, townIds });
  }

  @Post('admin')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create town (Admin only)' })
  async createAdmin(@Body() createTownDto: CreateTownDto, @GetUser() user: User) {
    if (!user.isSuperUser) {
      throw new ForbiddenException('Only super users can access this endpoint');
    }
    return this.townsService.create(createTownDto);
  }

  @Patch('admin/:id')
  @SearchSync('town', { param: 'id' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update town (Admin only)' })
  async updateAdmin(@Param('id') id: string, @Body() updateTownDto: UpdateTownDto, @GetUser() user: User) {
    await this.assertCanManageTown(user, id);
    return this.townsService.update(id, updateTownDto);
  }

  @Delete('admin/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete town (Admin only)' })
  async removeAdmin(@Param('id') id: string, @GetUser() user: User) {
    if (!user.isSuperUser) {
      throw new ForbiddenException('Only super users can access this endpoint');
    }
    return this.townsService.remove(id);
  }

  // ============================================================================
  // ADMIN IMAGE ENDPOINTS
  // ============================================================================

  @Get('admin/:id/images')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get town images (Admin only)' })
  async getImages(@Param('id') id: string, @GetUser() user: User) {
    await this.assertCanManageTown(user, id);
    return this.townImagesService.getImages(id);
  }

  @Post('admin/:id/images')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UseInterceptors(FilesInterceptor('files', 10))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload images to town (Admin only)' })
  async uploadImages(@Param('id') id: string, @UploadedFiles() files: Express.Multer.File[], @GetUser() user: User) {
    await this.assertCanManageTown(user, id);
    return this.townImagesService.uploadImages(id, files);
  }

  @Patch('admin/:id/images/:imageId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update town image (Admin only)' })
  async updateImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Body() dto: UpdateTownImageDto,
    @GetUser() user: User,
  ) {
    await this.assertCanManageTown(user, id);
    return this.townImagesService.updateImage(id, imageId, dto);
  }

  @Delete('admin/:id/images/:imageId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete town image (Admin only)' })
  async deleteImage(@Param('id') id: string, @Param('imageId') imageId: string, @GetUser() user: User) {
    await this.assertCanManageTown(user, id);
    return this.townImagesService.deleteImage(id, imageId);
  }

  @Put('admin/:id/images/reorder')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reorder town images (Admin only)' })
  async reorderImages(@Param('id') id: string, @Body() dto: ReorderImagesDto, @GetUser() user: User) {
    await this.assertCanManageTown(user, id);
    return this.townImagesService.reorderImages(id, dto);
  }

  @Put('admin/:id/images/hero')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set hero images for town (Admin only)' })
  async setHeroImages(@Param('id') id: string, @Body() dto: SetHeroImagesDto, @GetUser() user: User) {
    await this.assertCanManageTown(user, id);
    return this.townImagesService.setHeroImages(id, dto);
  }

  @Get('admin/:id/images/hero')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get hero images for town (Admin only)' })
  async getHeroImages(@Param('id') id: string, @GetUser() user: User) {
    await this.assertCanManageTown(user, id);
    return this.townImagesService.getHeroImages(id);
  }

  // ============================================================================
  // PUBLIC ENDPOINTS
  // ============================================================================

  @Get(':slugOrName/hero')
  @ApiOperation({ summary: 'Get hero images and slogan for a town by slug or name' })
  async getPublicHeroData(@Param('slugOrName') slugOrName: string) {
    return this.townImagesService.getPublicHeroData(slugOrName);
  }

  @Get(':slugOrName/info')
  @ApiOperation({ summary: 'Get town info (population, temperature, etc.) by slug or name' })
  async getPublicTownInfo(@Param('slugOrName') slugOrName: string) {
    return this.townImagesService.getPublicTownInfo(slugOrName);
  }

  @Get(':slugOrName/counts')
  @ApiOperation({ summary: 'Get counts of places, lodgings, restaurants, etc. by slug or name' })
  async getPublicCounts(@Param('slugOrName') slugOrName: string) {
    return this.townImagesService.getPublicCounts(slugOrName);
  }

  @Get(':slugOrName/gallery')
  @ApiOperation({ summary: 'Get all public images for a town by slug or name' })
  async getPublicGallery(@Param('slugOrName') slugOrName: string) {
    return this.townImagesService.getPublicGallery(slugOrName);
  }

  @Post()
  @SuperAdmin()
  create(@Body() createTownDto: CreateTownDto) {
    return this.townsService.create(createTownDto);
  }

  @Get()
  findAll() {
    return this.townsService.findAll();
  }

  @Get('for-map')
  @ApiOperation({ summary: 'Get all towns with coordinates for map display' })
  findAllForMap() {
    return this.townsService.findAllForMap();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.townsService.findOne(id);
  }

  @Patch(':id')
  @SearchSync('town', { param: 'id' })
  @SuperAdmin()
  update(@Param('id') id: string, @Body() updateTownDto: UpdateTownDto) {
    return this.townsService.update(id, updateTownDto);
  }

  @Delete(':id')
  @SuperAdmin()
  remove(@Param('id') id: string) {
    return this.townsService.remove(id);
  }
}
