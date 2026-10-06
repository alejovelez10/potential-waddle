import { ApiProperty } from '@nestjs/swagger';

export class HomeItemDto {
  @ApiProperty({ description: 'The unique identifier' })
  id: string;

  @ApiProperty({ description: 'The name of the item' })
  name: string;

  @ApiProperty({ description: 'The slug of the item' })
  slug: string;

  @ApiProperty({ description: 'The first image URL', required: false })
  image?: string;

  @ApiProperty({ description: 'Average rating', required: false })
  rating?: number;

  @ApiProperty({ description: 'Number of reviews', required: false })
  reviewCount?: number;

  @ApiProperty({ description: 'Name of the first category', required: false })
  category?: string;

  @ApiProperty({ description: 'Difficulty level (1-5), places and experiences only', required: false })
  difficultyLevel?: number;

  @ApiProperty({ description: 'Distance to the urban center in meters, places only', required: false })
  distanceMeters?: number;

  @ApiProperty({ description: 'Id of the current user review for this item', required: false })
  userReview?: string;
}

export class HomeDataDto {
  @ApiProperty({ type: [HomeItemDto], description: 'Random places' })
  places: HomeItemDto[];

  @ApiProperty({ type: [HomeItemDto], description: 'Random lodgings' })
  lodgings: HomeItemDto[];

  @ApiProperty({ type: [HomeItemDto], description: 'Random restaurants' })
  restaurants: HomeItemDto[];

  @ApiProperty({ type: [HomeItemDto], description: 'Random experiences' })
  experiences: HomeItemDto[];
}
