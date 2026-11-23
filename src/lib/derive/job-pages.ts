/** A job list opens on 50 jobs, and each "Load more" adds 10 (decided by Zuhair, 2026-11-22). */
export const FIRST_JOBS_PAGE = 50;
export const NEXT_JOBS_PAGE = 10;

export const jobPageSize = (offset: number) => (offset === 0 ? FIRST_JOBS_PAGE : NEXT_JOBS_PAGE);
