import type { User } from 'src/modules/users/entities';
import type { ExperienceFiltersDto } from '../dto';

export interface ExperienceFindAllParams {
  filters?: ExperienceFiltersDto;
  user?: User | null;
  locale?: string;
}
