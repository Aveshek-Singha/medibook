export interface PaginationInput {
  page?: number;
  limit?: number;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export const normalizePagination = ({
  page = 1,
  limit = 20,
}: PaginationInput) => ({
  page: Math.max(1, Math.floor(page)),
  limit: Math.min(100, Math.max(1, Math.floor(limit))),
});

export const paginationMeta = (
  total: number,
  page: number,
  limit: number,
): PaginationMeta => ({
  total,
  page,
  limit,
  totalPages: total === 0 ? 0 : Math.ceil(total / limit),
});

export const paginate = <T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResponse<T> => ({
  data,
  meta: paginationMeta(total, page, limit),
});
