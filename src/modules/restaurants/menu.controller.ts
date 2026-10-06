import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RestaurantMenuAccessGuard } from './guards/restaurant-menu-access.guard';
import { ApiTags, ApiConsumes, ApiOkResponse, ApiBody } from '@nestjs/swagger';
import { Auth } from '../auth/decorators';
import { MenuService } from './services/menu.service';
import { MenuDto } from './dto';
import { ContentTypes } from '../common/constants';
import { EntityAccess } from '../common/decorators/entity-access.decorator';

@Controller('restaurants/:restaurantId/menus')
@ApiTags('Restaurant Menus')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @Get()
  @Auth()
  @ApiOkResponse({ description: 'List all menus for restaurant', type: [MenuDto] })
  findAll(@Param('restaurantId', ParseUUIDPipe) restaurantId: string) {
    return this.menuService.findAllByRestaurant(restaurantId);
  }

  @Get('latest')
  @Auth()
  @ApiOkResponse({ description: 'Get latest completed menu', type: MenuDto })
  findLatest(@Param('restaurantId', ParseUUIDPipe) restaurantId: string) {
    return this.menuService.findLatest(restaurantId);
  }

  @Get(':menuId')
  @Auth()
  @ApiOkResponse({ description: 'Get menu by ID', type: MenuDto })
  findOne(@Param('menuId', ParseUUIDPipe) menuId: string) {
    return this.menuService.findOne(menuId);
  }

  @Post('upload')
  @EntityAccess('manage', 'restaurant', { param: 'restaurantId' })
  @UseGuards(RestaurantMenuAccessGuard)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes(ContentTypes.MULTIPART_FORM_DATA)
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOkResponse({ description: 'Upload and process menu file', type: MenuDto })
  upload(@Param('restaurantId', ParseUUIDPipe) restaurantId: string, @UploadedFile() file: Express.Multer.File) {
    return this.menuService.processAndCreate(restaurantId, file);
  }

  @Delete(':menuId')
  @EntityAccess('manage', 'restaurant', { param: 'restaurantId' })
  @UseGuards(RestaurantMenuAccessGuard)
  @ApiOkResponse({ description: 'Delete menu' })
  delete(@Param('restaurantId', ParseUUIDPipe) restaurantId: string, @Param('menuId', ParseUUIDPipe) menuId: string) {
    return this.menuService.delete(menuId);
  }
}
