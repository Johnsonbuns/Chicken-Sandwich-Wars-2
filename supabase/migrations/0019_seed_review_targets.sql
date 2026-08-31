-- 0019_seed_review_targets.sql
--
-- What the review queue may write, and which columns of it.
--
-- This file is the security boundary for everything in 0018: the apply function builds
-- dynamic SQL, and this is the list of tables and columns it can build it against.
-- Nothing outside this seed is reachable by a proposal, from a person or an agent, so
-- adding a row here is a deliberate act and not configuration.
--
-- Deliberately absent: staff_profiles, agent_keys, the review_* tables themselves, the
-- scoring tables and anything in intake. Roles are granted in the Supabase dashboard,
-- scores are computed rather than asserted, and PII is not intelligence.
--
-- Columns absent by design across every target: id, created_at, updated_at (managed),
-- geog (PostGIS, set by geocoding rather than by hand), superseded_at / superseded_by
-- (set by the supersede path), and articles.body (Sanity's Portable Text, Phase 5).

insert into public.review_targets (
  table_name, label, plural_label, group_label, description, help_md,
  allowed_columns, required_columns, identity_columns, label_expression,
  update_strategy, requires_source, supports_visibility, sort_order) values

-- ---- Real estate -----------------------------------------------------------
('public.transactions', 'Transaction', 'Transactions', 'Real estate',
 'A sale, portfolio acquisition, sale-leaseback or refranchising deal.',
 'Use `subject = property` for a building trading and `subject = company` for an operator or brand changing hands. A price that was not disclosed goes in as `is_price_disclosed = false` with no price, never as an estimate.',
 array['slug','kind','subject','announced_on','closed_on','date_label','price_usd',
       'is_price_disclosed','cap_rate_pct','noi_usd','unit_count','buyer_company_id',
       'seller_company_id','target_company_id','brand_id','brand_label','target_label',
       'acquirer_label','location_label','term_label','detail_md','source_id',
       'is_published','visibility','sort_index'],
 array['kind','subject','date_label','source_id'],
 array['location_label'],
 'coalesce(t.location_label, t.target_label, t.date_label)',
 'update', true, true, 10),

('public.properties', 'Property', 'Properties', 'Real estate',
 'A building or site. Exists before, between and after any transaction on it.',
 'One row per parcel, not per deal. A former KFC reopening as a Dave''s is the same property with a new occupancy — add the occupancy, do not add a second property.',
 array['slug','address_line1','address_line2','city','state','postal_code','county',
       'country','address_normalized','parcel_apn','market_id','location_label',
       'building_sqft','lot_acres','year_built','year_renovated','drive_thru_lanes',
       'seat_count','prototype_note','status','is_second_generation','prior_use',
       'record_source','verification','is_published','source_id','notes_md','visibility'],
 '{}', array['address_line1'],
 'coalesce(t.address_line1 || '', '' || coalesce(t.city,''''), t.location_label, t.slug::text)',
 'update', false, true, 20),

('public.property_occupancies', 'Location (tenancy)', 'Locations', 'Real estate',
 'Which brand occupies a property, and when it opened or closed.',
 'This is the unit-level record. A brand closing 312 restaurants nationally is not one of these — that is an Opening or closure, or a figure.',
 array['property_id','brand_id','operator_company_id','status','opened_on','closed_on',
       'closure_reason','detail_md','date_label','source_id','visibility'],
 array['property_id','status'],
 array['property_id','brand_id','opened_on'],
 'coalesce(t.date_label, t.status::text)',
 'update', true, true, 30),

('public.leases', 'Lease', 'Leases', 'Real estate',
 'Lease structure, term, guarantee and rent on a property.',
 'Keep the published phrasing in `term_label` as well as the parsed columns — nothing should be lost in the decomposition. Rent and escalation figures are usually confidential; set the visibility accordingly.',
 array['property_id','tenant_company_id','brand_id','structure','guarantee',
       'commencement_on','expiration_on','initial_term_years','option_count',
       'option_term_years','base_annual_rent_usd','escalation_pct','escalation_years',
       'escalation_note','rent_schedule','term_label','source_id','visibility'],
 array['property_id'], array['property_id'],
 'coalesce(t.term_label, t.structure::text, t.id::text)',
 'update', true, true, 40),

('public.listings', 'Marketplace listing', 'Listings', 'Real estate',
 'A property offered for sale through CSW.',
 'A listing cannot go active without `authorization_on_file` — the database enforces the promise the site makes.',
 array['slug','headline','summary_md','status','asking_price_usd','cap_rate_pct','noi_usd',
       'is_price_on_request','broker_company_id','authorization_on_file',
       'authorization_received_on','listed_on','expires_on','brand_id','brand_label',
       'source_id','date_label','location_label','term_label','sort_index','visibility'],
 array['headline','status'], array['headline'],
 't.headline', 'update', false, true, 50),

-- ---- System movement -------------------------------------------------------
('public.system_movements', 'Opening or closure', 'Openings & closures', 'System',
 'A brand opening or closing units, at whatever scope it was published at.',
 'Aggregates belong here: "KFC closed 312 U.S. restaurants" carries a count and a geographic scope, which a figure has nowhere to put. If the event is one identifiable box, add the property and link it.',
 array['brand_id','brand_label','direction','date_label','occurred_on','period_start',
       'period_end','unit_count','location_label','detail_md','property_id','source_id',
       'ordinal','is_published','visibility'],
 array['direction','date_label','source_id'],
 array['brand_id','date_label','location_label'],
 'coalesce(t.brand_label, '''') || '' '' || t.direction::text || '' '' || t.date_label',
 'update', true, true, 60),

-- ---- Entities --------------------------------------------------------------
('public.companies', 'Operator or company', 'Companies', 'Entities',
 'An operator, franchisor parent, investor, REIT, broker or lender.',
 'One table for all of them, because the same entity appears in several roles — KBP operates restaurants and buys portfolios.',
 array['slug','name','legal_name','hq_city','hq_state','hq_country','hq_label','website',
       'founded_year','kind','status','status_note','geography','analysis_md',
       'is_published','visibility'],
 array['slug','name','kind'], array['name'],
 't.name', 'update', false, true, 70),

('public.brands', 'Brand', 'Brands', 'Entities',
 'A restaurant brand — or a non-chicken brand an operator also runs.',
 'Set `is_chicken = false` and the right sector for a brand that only exists so an operator''s portfolio can be a real foreign key. Only chicken brands are published.',
 array['slug','name','legal_name','is_chicken','sector','hq_city','hq_state','hq_country',
       'hq_label','founded_year','parent_company_id','parent_label','ownership_type',
       'ownership_label','franchise_model_md','momentum','analysis_md','is_published',
       'visibility'],
 array['slug','name'], array['name'],
 't.name', 'update', false, true, 80),

('public.markets', 'Market', 'Markets', 'Entities',
 'A metro or state CSW tracks as a market.',
 null,
 array['slug','name','state','cbsa_code','thesis_md','is_published','visibility'],
 array['slug','name'], array['name'],
 't.name', 'update', false, true, 90),

('public.brand_operators', 'Brand ↔ operator link', 'Operator links', 'Entities',
 'Which operator runs how many units of which brand.',
 'Keep `brand_label` as the operator publishes it — "KFC" where the brand record says "KFC U.S." The label as published is not the same fact as the foreign key.',
 array['brand_id','company_id','unit_count','as_of','period_label','source_id',
       'is_current','brand_label','visibility'],
 array['brand_id','company_id'], array['brand_id','company_id'],
 'coalesce(t.brand_label, '''') || '' · '' || coalesce(t.unit_count::text, ''—'')',
 'update', true, true, 100),

-- ---- Figures and prose -----------------------------------------------------
('public.facts', 'Figure', 'Figures', 'Data',
 'One published number about one subject, for one period.',
 'Corrections supersede rather than overwrite: approving an edit here writes a new observation and closes the old one, so last quarter''s published figure survives. Never enter a figure that has not been published — leave it absent and the site shows an em dash.',
 array['subject_type','subject_id','metric_key','value_numeric','value_text','unit',
       'period_label','period_start','period_end','as_of','source_id','derivation',
       'derivation_note','note','visibility'],
 array['subject_type','subject_id','metric_key','unit','period_label','source_id'],
 array['subject_id','metric_key','period_label'],
 't.metric_key::text || '' · '' || t.period_label',
 'supersede', true, true, 110),

('public.brand_cap_rates', 'Cap rate', 'Cap rates', 'Data',
 'The net-lease market''s pricing of a brand''s credit.',
 'Attaches to the brand, not to a property. `brand_id` may be null for a benchmark that is not one brand — "McDonald''s (reference)", "Franchisee QSR" — in which case fill in `brand_label`.',
 array['brand_id','brand_label','low_pct','high_pct','mid_pct','range_label','structure',
       'basis','period_label','as_of','source_id','visibility'],
 array['range_label'], array['brand_id','period_label'],
 'coalesce(t.brand_label, '''') || '' '' || t.range_label',
 'supersede', true, true, 120),

('public.entity_notes', 'Note', 'Notes', 'Data',
 'A sourced prose bullet attached to a brand, company, market or category.',
 'Pipeline items, operator facts, market activity, lease intel, supply notes and consumer context are all this shape. Only `market_watch` and `real_estate_note` may stand without a citation — they are CSW''s own characterisation rather than a published claim.',
 array['subject_type','subject_id','kind','label','body_md','period_label','as_of',
       'source_id','ordinal','is_published','visibility'],
 array['subject_type','subject_id','kind','body_md'],
 array['subject_id','kind','label'],
 'coalesce(t.label, left(t.body_md, 60))',
 'update', true, true, 130),

('public.expansion_agreements', 'Expansion agreement', 'Expansion agreements', 'Data',
 'A committed development deal: a brand, a market and a unit count.',
 '`operator_label` is what was announced and may not be an entity at all — "Multiple franchisees", "Company". Keep it either way.',
 array['brand_id','brand_label','operator_company_id','operator_label','market_id',
       'market_label','unit_count','units_label','announced_on','announced_label',
       'timeline_note','status','source_id','is_published','sort_index','visibility'],
 array['brand_id','market_label','announced_label','source_id'],
 array['brand_id','market_label'],
 'coalesce(t.brand_label, '''') || '' → '' || t.market_label',
 'update', true, true, 140),

-- ---- Editorial -------------------------------------------------------------
('public.articles', 'News or research', 'Articles', 'Editorial',
 'A news item, research note or analysis piece.',
 '`means_md` is the "what it means" line every news item carries. It is editorial rather than reported, and it is the reason to publish rather than link.',
 array['slug','kind','category','title','dek','body_md','means_md','read_minutes',
       'date_label','published_at','status','primary_source_id','sort_index','visibility'],
 array['slug','kind','title'], array['title'],
 't.title', 'update', true, true, 150),

('public.industry_events', 'Industry event', 'Events', 'Editorial',
 'A conference or industry gathering.',
 null,
 array['slug','name','starts_on','ends_on','date_label','city','state','location_label',
       'venue','url','why_md','source_id','is_published','sort_order','visibility'],
 array['name','date_label'], array['name'],
 't.name', 'update', false, true, 160),

('public.job_postings', 'Job posting', 'Jobs', 'Editorial',
 'A role on the CSW job board.',
 null,
 array['slug','company_id','brand_id','title','market_id','location_label',
       'employment_type','comp_min_usd','comp_max_usd','description_md','apply_url',
       'posted_at','expires_on','status','visibility'],
 array['title'], array['title','company_id'],
 't.title', 'update', false, true, 170),

-- ---- Provenance ------------------------------------------------------------
('public.sources', 'Source', 'Sources', 'Provenance',
 'A publisher, a title, a URL and a date. Everything on the site resolves to one.',
 'Most of the time you do not add one here: cite the URL on the proposal itself and the source record is created when it is approved. Use this to correct a source, or to register one ahead of the figures that will cite it.',
 array['key','publisher','title','url','date_label','published_on','source_type',
       'verified_against_primary','archive_url','accessed_at'],
 array['key','publisher','title','url'], array['url'],
 't.publisher || '' — '' || t.title',
 'update', false, false, 180);

-- ---------------------------------------------------------------------------
-- The whitelist has to be true. A column named here that does not exist on the table
-- is not a typo that shows up later as an empty form field - it is a proposal that
-- fails at the moment of approval, which is the worst time to find out.
-- ---------------------------------------------------------------------------
do $$
declare rt public.review_targets; col text; bad text[] := '{}';
begin
  for rt in select * from public.review_targets loop
    foreach col in array (rt.allowed_columns || rt.required_columns || rt.identity_columns) loop
      if not exists (select 1 from pg_attribute a
                      where a.attrelid = rt.table_name::regclass
                        and a.attname = col and a.attnum > 0 and not a.attisdropped) then
        bad := bad || (rt.table_name || '.' || col);
      end if;
    end loop;
    -- required and identity columns have to be writable, or they are unreachable.
    foreach col in array (rt.required_columns || rt.identity_columns) loop
      if not (col = any(rt.allowed_columns)) then
        bad := bad || (rt.table_name || '.' || col || ' (required or identity but not allowed)');
      end if;
    end loop;
    -- The label expression has to parse, or every duplicate check on this target fails.
    execute format('select %s from %I.%I t where false',
                   rt.label_expression, split_part(rt.table_name, '.', 1),
                   split_part(rt.table_name, '.', 2));
  end loop;
  if cardinality(bad) > 0 then
    raise exception 'review_targets names columns that do not exist: %', array_to_string(bad, ', ');
  end if;
end $$;
