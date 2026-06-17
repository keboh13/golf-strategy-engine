-- Seed: Lost Pines Golf Club at Hyatt Regency Lost Pines (formerly Wolfdancer GC)
-- Champion tees, public yardage: 7,304y / Par 72
-- Per-hole breakdown is left empty here. Populate by hitting the new
-- /api/course-ai yardage-book endpoint or running an UPDATE with verified data,
-- then drop the `_needs_review` flag.

insert into public.course_cache (cache_key, course_data, source, cached_at)
values (
  'lost pines golf club|lost pines, tx',
  jsonb_build_object(
    'name', 'Lost Pines Golf Club',
    'location', 'Lost Pines, TX',
    'yardage', '7304',
    'rating', '74.6',
    'slope', '136',
    'par', 72,
    'selectedTee', 'Champion',
    'source', 'official Hyatt Regency Lost Pines yardage book',
    '_source', 'yardage_book',
    '_confidence', 'medium',
    '_needs_review', true,
    'holes', '[]'::jsonb
  ),
  'yardage_book',
  now()
)
on conflict (cache_key) do update
  set course_data = excluded.course_data,
      source      = excluded.source,
      cached_at   = excluded.cached_at;
