import type { CommerceFiltersDto } from '../dto';
import type { User } from 'src/modules/users/entities';

export interface CommerceFindAllParams {
  filters?: CommerceFiltersDto;
  user?: User | null;
  locale?: string;
}
