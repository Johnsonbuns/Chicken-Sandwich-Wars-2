-- 0002_enums.sql
-- Enums for structural, closed sets only.
--
-- Editorial vocabularies that an editor should be able to extend without a migration
-- (momentum, tags) are lookup tables in 0004 instead. The dividing line: if adding a
-- value requires code to know about it, it is an enum; if it is just another label,
-- it is a row.

create type subject_type as enum ('brand','company','property','market','category','listing');

create type metric_unit as enum ('usd','count','pct','bps','usd_per_sqft','sqft','acres','lb','years','ratio');

create type derivation as enum ('reported','derived','franchisee_reported','company_guidance');

create type source_type as enum ('sec_filing','company_release','trade_press','data_provider',
                                'brokerage_report','fdd','court_filing','government','other');

create type note_kind as enum ('pipeline','operator_fact','market_activity','market_watch',
                              'lease_intel','supply','consumer_context','real_estate_note','risk');

create type company_kind as enum ('franchisor','operator','private_equity','reit','public_holding',
                                 'broker','lender','developer','supplier','other');

create type company_status as enum ('active','acquiring','divesting','refranchising','newly_formed',
                                   'stable','acquired','restructuring','liquidated');

create type ownership_type as enum ('private','public','public_parent','pe_owned','pe_controlled',
                                   'private_intl_parent','family_controlled','restructured');

-- Operator portfolios run past chicken and past restaurants entirely: the 16 operators
-- collectively hold Meineke and Take 5 Oil Change alongside Taco Bell and 7-Eleven.
create type brand_sector as enum ('restaurant','convenience','automotive','retail','other');

create type property_status as enum ('land','entitled','under_construction','operating','dark',
                                    'for_sale','under_contract','sold','demolished','converted');

create type record_source as enum ('editorial','user_submitted','imported','broker_feed');

create type verification_state as enum ('unverified','desk_reviewed','verified','rejected');

create type occupancy_status as enum ('announced','under_construction','open','closed');

create type closure_reason as enum ('lease_rejection','underperformance','relocation',
                                   'franchisee_bankruptcy','remodel','landlord_action',
                                   'brand_exit','unknown');

create type lease_structure as enum ('ground_lease','absolute_nnn','nnn','double_net',
                                    'modified_gross','gross');

create type lease_guarantee as enum ('corporate','franchisee','personal','unsecured','none','unknown');

create type transaction_kind as enum ('property_sale','portfolio_acquisition','ground_lease_sale',
                                     'sale_leaseback','listing','brand_acquisition',
                                     'franchisee_portfolio','bankruptcy_sale','company_store_sale',
                                     'growth_investment','refranchising');

create type transaction_subject as enum ('property','company');

create type listing_status as enum ('draft','pending_authorization','active','under_contract',
                                   'sold','withdrawn','expired');

create type agreement_status as enum ('announced','in_progress','complete','lapsed','unknown');

create type article_kind as enum ('news','research','analysis','page','newsletter_issue');

create type article_status as enum ('draft','review','published','archived');

create type chart_kind as enum ('bar','line','area','stacked_bar');

create type staff_role as enum ('admin','editor','analyst','viewer');
