import type { User } from 'src/modules/users/entities';
import type { RestaurantFiltersDto } from '../dto';

export interface RestaurantFindAllParams {
  filters?: RestaurantFiltersDto;
  user?: User | null;
  locale?: string;
}
