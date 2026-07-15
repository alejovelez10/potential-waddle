import type { User } from 'src/modules/users/entities';
import type { GuidesFiltersDto } from '../dto/guides-filters.dto';

export interface GuideFindAllParams {
  filters?: GuidesFiltersDto;
  user?: User | null;
  locale?: string;
}
