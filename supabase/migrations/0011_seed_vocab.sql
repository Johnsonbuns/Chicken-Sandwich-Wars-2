-- 0011_seed_vocab.sql
-- Controlled vocabularies and the scoring formula. Generated from data/*.json and
-- lib/score.js so the seed cannot drift from what the site currently renders.
--
-- Regenerate, do not hand-edit.

-- Momentum vocabulary. A value the site does not recognise falls back to a neutral
-- badge rather than erroring, so this is a lookup table and not an enum.
insert into public.momentum_states (key, label, badge_class, sort_order) values
  ('leader', 'Leader', 'leader', 10),
  ('hot', 'Hot', 'hot', 20),
  ('split', 'Split', 'split', 30),
  ('pressured', 'Pressured', 'pressured', 40),
  ('turnaround', 'Turnaround', 'turnaround', 50),
  ('steady', 'Steady', 'steady', 60),
  ('expanding', 'Expanding', 'expanding', 70),
  ('stabilizing', 'Stabilizing', 'stabilizing', 80),
  ('rocket', 'Rocket', 'rocket', 90),
  ('growing', 'Growing', 'growing', 100),
  ('emerging', 'Emerging', 'emerging', 110),
  ('distressed', 'Distressed', 'distressed', 120),
  ('mixed', 'Mixed', 'mixed', 130);

insert into public.tags (key, label, kind) values
  ('chicken sandwich', 'Chicken Sandwich', 'brand'),
  ('national', 'National', 'brand'),
  ('franchised', 'Franchised', 'brand'),
  ('growing', 'Growing', 'brand'),
  ('tenders', 'Tenders', 'brand'),
  ('corporate', 'Corporate', 'brand'),
  ('wings', 'Wings', 'brand'),
  ('public', 'Public', 'brand'),
  ('fried chicken', 'Fried Chicken', 'brand'),
  ('declining', 'Declining', 'brand'),
  ('regional', 'Regional', 'brand'),
  ('breakfast', 'Breakfast', 'brand'),
  ('value', 'Value', 'brand'),
  ('hot chicken', 'Hot Chicken', 'brand'),
  ('fast casual', 'Fast Casual', 'brand'),
  ('grilled chicken', 'Grilled Chicken', 'brand'),
  ('emerging', 'Emerging', 'brand'),
  ('non-traditional', 'Non-Traditional', 'brand'),
  ('c-store', 'C-Store', 'brand'),
  ('korean fried chicken', 'Korean Fried Chicken', 'brand'),
  ('casual dining', 'Casual Dining', 'brand'),
  ('distressed', 'Distressed', 'brand'),
  ('international', 'International', 'brand');

-- Published figures carried by brand.stats. 33 keys across 21 brands, averaging 3.7
-- each and 24 of them used by exactly one brand - which is why these are fact rows
-- against a vocabulary rather than columns on a table.
insert into public.metrics (key, json_key, label, unit, display_format, subject_types, is_scoring_input, sort_order) values
  ('us_units', 'usUnits', 'U.S. units', 'count', 'count', '{brand}', false, 10),
  ('systemwide_sales', 'systemwideSales', 'Systemwide sales', 'usd', 'usd', '{brand}', false, 20),
  ('auv', 'auv', 'AUV', 'usd', 'usd', '{brand}', false, 30),
  ('global_units', 'globalUnits', 'Global units', 'count', 'count', '{brand}', false, 40),
  ('comps_latest', 'compsLatest', 'Comps latest', 'pct', 'pct', '{brand}', false, 50),
  ('units_prior', 'unitsPrior', 'Units prior', 'count', 'count', '{brand}', false, 60),
  ('openings_2025', 'openings2025', 'Openings 2025', 'count', 'count', '{brand}', false, 70),
  ('unit_change', 'unitChange', 'Unit change', 'count', 'count', '{brand}', false, 80),
  ('comps_fy', 'compsFY', 'Comps fy', 'pct', 'pct', '{brand}', false, 90),
  ('blended_auv', 'blendedAuv', 'Blended AUV', 'usd', 'usd', '{brand}', false, 100),
  ('current_units', 'currentUnits', 'Current units', 'count', 'count', '{brand}', false, 110),
  ('us_canada_units', 'usCanadaUnits', 'U.S. canada units', 'count', 'count', '{brand}', false, 120),
  ('franchisee_profit', 'franchiseeProfit', 'Franchisee profit', 'usd', 'usd', '{brand}', false, 130),
  ('us_closures_2025', 'usClosures2025', 'U.S. closures 2025', 'count', 'count', '{brand}', false, 140),
  ('closures_15mo', 'closures15mo', 'Closures 15mo', 'count', 'count', '{brand}', false, 150),
  ('closures_ttm', 'closuresTTM', 'Closures TTM', 'count', 'count', '{brand}', false, 160),
  ('global_sales', 'globalSales', 'Global sales', 'usd', 'usd', '{brand}', false, 170),
  ('units_2025', 'units2025', 'Units 2025', 'count', 'count', '{brand}', false, 180),
  ('units_2024', 'units2024', 'Units 2024', 'count', 'count', '{brand}', false, 190),
  ('systemwide_sales_2024', 'systemwideSales2024', 'Systemwide sales 2024', 'usd', 'usd', '{brand}', false, 200),
  ('sales_growth_2025', 'salesGrowth2025', 'Sales growth 2025', 'pct', 'pct', '{brand}', false, 210),
  ('deal_value', 'dealValue', 'Deal value', 'usd', 'usd', '{brand}', false, 220),
  ('agreements_2025', 'agreements2025', 'Agreements 2025', 'count', 'count', '{brand}', false, 230),
  ('pipeline_units', 'pipelineUnits', 'Pipeline units', 'count', 'count', '{brand}', false, 240),
  ('openings', 'openings', 'Openings', 'count', 'count', '{brand}', false, 250),
  ('agreements', 'agreements', 'Agreements', 'count', 'count', '{brand}', false, 260),
  ('openings_2024', 'openings2024', 'Openings 2024', 'count', 'count', '{brand}', false, 270),
  ('commitments', 'commitments', 'Commitments', 'count', 'count', '{brand}', false, 280),
  ('company_units_sold', 'companyUnitsSold', 'Company units sold', 'count', 'count', '{brand}', false, 290),
  ('closures', 'closures', 'Closures', 'count', 'count', '{brand}', false, 300),
  ('debt', 'debt', 'Debt', 'usd', 'usd', '{brand}', false, 310),
  ('closures_h_1', 'closuresH1', 'Closures h 1', 'count', 'count', '{brand}', false, 320),
  ('opening_target', 'openingTarget', 'Opening target', 'count', 'count', '{brand}', false, 330);

-- Derived numerics that feed the CSW Score, plus the figures carried on entities
-- other than brands. net_unit_decline is a boolean stored as 1/0: it gates the
-- uniform four-point penalty rather than being scaled like the others.
insert into public.metrics (key, json_key, label, unit, display_format, subject_types, is_scoring_input, sort_order) values
  ('comps_pct',             'compsPct',        'Same-store sales',        'pct',   'pct',   '{brand}',   true,  500),
  ('auv_usd',               'auvUsd',          'Average unit volume',     'usd',   'usd',   '{brand}',   true,  510),
  ('unit_growth_pct',       'unitGrowthPct',   'Unit growth',             'pct',   'pct',   '{brand}',   true,  520),
  ('sales_growth_pct',      'salesGrowthPct',  'Systemwide sales growth', 'pct',   'pct',   '{brand}',   true,  530),
  ('cap_rate_mid',          'capRateMid',      'Cap rate midpoint',       'pct',   'pct',   '{brand}',   true,  540),
  ('net_unit_decline',      'netClosures',     'System in net unit decline', 'ratio', 'count', '{brand}', true, 550),
  ('operator_chicken_units','chickenUnits',    'Chicken units operated',  'count', 'count', '{company}', false, 600),
  ('operator_total_units',  'totalUnits',      'Total units operated',    'count', 'count', '{company}', false, 610),
  ('cap_rate_corporate_qsr',      null, 'Corporate-guaranteed QSR cap rate',   'pct', 'pct', '{category}', false, 700),
  ('cap_rate_franchisee_qsr',     null, 'Franchisee-guaranteed QSR cap rate',  'pct', 'pct', '{category}', false, 710),
  ('cap_rate_all_net_lease',      null, 'All single-tenant net lease cap rate','pct', 'pct', '{category}', false, 720),
  ('cap_rate_single_tenant_retail',null,'Single-tenant retail cap rate',       'pct', 'pct', '{category}', false, 730),
  ('cap_rate_premium_ground_lease',null,'Premium QSR ground lease cap rate',   'pct', 'pct', '{category}', false, 740);

-- CSW Score v1. These values mirror lib/score.js exactly; /methodology/ reads them,
-- so a weight change here is the single edit that updates the published formula.
insert into public.score_versions (version, effective_from, min_components, penalty_note, notes_md, is_current) values
  (1, '2026-08-01', 3,
   'A system in net unit decline takes a uniform four-point penalty.',
   'Five components, each scaled linearly between a published floor and ceiling and clamped to 0-100. Weights renormalise over whichever components a brand actually has. Fewer than three available components means no score at all.',
   true);

insert into public.score_components (version, key, label, weight, metric_key, floor_value, ceil_value, floor_score, ceil_score, description, sort_order) values
  (1, 'demand', 'Consumer Demand', 25, 'comps_pct', -8, 4, 20, 95, 'Most recently reported same-store sales.', 10),
  (1, 'economics', 'Unit Economics', 30, 'auv_usd', 1000000, 9500000, 40, 100, 'Average unit volume.', 20),
  (1, 'expansion', 'Expansion', 18, 'unit_growth_pct', -5, 55, 20, 100, 'Unit growth over the latest reported year.', 30),
  (1, 'realestate', 'Real Estate Strength', 15, 'cap_rate_mid', 7.5, 4.2, 45, 100, 'Cap rate on the brand’s net-lease product — lower is stronger.', 40),
  (1, 'momentum', 'System Momentum', 12, 'sales_growth_pct', -5, 55, 25, 100, 'Systemwide sales growth over the latest reported year.', 50);

insert into public.score_adjustments (version, key, label, metric_key, points, condition) values
  (1, 'net_unit_decline', 'Net unit decline', 'net_unit_decline', -4,
   'Applied when net_unit_decline = 1. Uniform across every brand that qualifies.');

