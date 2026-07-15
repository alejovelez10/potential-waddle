import type { LodgingFiltersDto } from '../dto';
import type { User } from 'src/modules/users/entities';

export interface LodgingFindAllParams {
  filters?: LodgingFiltersDto;
  user?: User;
  locale?: string;
}
