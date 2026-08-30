-- 0015_roundtrip_fidelity.sql
--
-- Everything the round-trip check proved was being lost. Each column exists because
-- exporting without it produced a file that differed from data/.

-- 1. Display order. Several JSON files are ordered arrays and the site renders them in
--    file order. Sorting by id on the way out reshuffled them.
alter table public.transactions          add column sort_index int not null default 0;
alter table public.expansion_agreements  add column sort_index int not null default 0;
alter table public.listings              add column sort_index int not null default 0;
alter table public.industry_events       add column sort_order int not null default 0;

-- 2. Labels as written, which are not always the brand's canonical name.
--    operators[].brands says "KFC" where the brand record is "KFC U.S."; movement says
--    "Jollibee Foods Corporation" where the brand is "Jollibee (U.S.)". Deriving the
--    label from the joined row silently rewrote the published text, so the string as
--    published is stored alongside the foreign key rather than in place of it.
alter table public.brand_operators       add column brand_label text;
alter table public.system_movements      add column brand_label text;
alter table public.expansion_agreements  add column brand_label text;

-- 3. Chart units are free-form display strings — 'usdM', 'units', 'pct' — not the
--    metric_unit enum. Both are wanted: the enum for querying, the label for rendering.
alter table public.chart_series add column unit_label text;

-- 4. A published ranking credits its publisher in its own words: "Stacker, using YouGov
--    data on 272 dining brands", not the source record's bare "Stacker / YouGov".
alter table public.published_rankings add column publisher_label text;

-- 5. Transactions name their brand as published too: "Popeyes", not the brand record's
--    "Popeyes Louisiana Kitchen".
alter table public.transactions add column brand_label text;
alter table public.listings     add column brand_label text;
