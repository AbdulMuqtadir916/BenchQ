"""baseline

Revision ID: 0001
Revises: 
Create Date: 2026-10-20 21:12:16.238353
"""
from alembic import op
import sqlalchemy as sa


revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Baseline: the schema the old startup path produced (create_tables() + seed.run_migrations() +
    # migrate_h1b_to_visa_cache), generated from the models and reviewed against a database built that way
    # (tests/test_schema_matches_legacy.py keeps the two identical). Do not edit; add a new revision.
    # Job.short_id's server default reads this sequence, so it must exist before the table.
    op.execute("CREATE SEQUENCE IF NOT EXISTS jobs_short_id_seq")
    op.create_table('activity_log_v2',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('type', sa.String(), nullable=False),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('company', sa.String(), nullable=True),
    sa.Column('details', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('companies',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=True),
    sa.Column('scrape_urls', sa.JSON(), nullable=True),
    sa.Column('tier', sa.Integer(), nullable=True),
    sa.Column('selected_resume_ids', sa.JSON(), nullable=True),
    sa.Column('playwright_enabled', sa.Boolean(), nullable=True),
    sa.Column('scrape_interval_minutes', sa.Integer(), nullable=True),
    sa.Column('title_include_expr', sa.String(), nullable=True),
    sa.Column('title_exclude_keywords', sa.JSON(), nullable=True),
    sa.Column('wait_for_selector', sa.String(), nullable=True),
    sa.Column('max_pages', sa.Integer(), nullable=True),
    sa.Column('jobspy_search_term', sa.String(), nullable=True),
    sa.Column('aliases', sa.JSON(), nullable=True),
    sa.Column('auto_scoring_depth', sa.String(), nullable=True),
    sa.Column('h1b_slug', sa.String(), nullable=True),
    sa.Column('last_scraped_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('warning_acknowledged_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name')
    )
    op.create_table('personas',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('contact', sa.JSON(), nullable=True),
    sa.Column('work_auth', sa.JSON(), nullable=True),
    sa.Column('demographics', sa.JSON(), nullable=True),
    sa.Column('compensation', sa.JSON(), nullable=True),
    sa.Column('preferences', sa.JSON(), nullable=True),
    sa.Column('resume_content', sa.JSON(), nullable=True),
    sa.Column('qa_bank', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('searches',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=True),
    sa.Column('sources', sa.JSON(), nullable=True),
    sa.Column('search_mode', sa.String(), nullable=True),
    sa.Column('search_term', sa.String(), nullable=True),
    sa.Column('direct_url', sa.String(), nullable=True),
    sa.Column('location', sa.String(), nullable=True),
    sa.Column('country', sa.String(), server_default='usa', nullable=True),
    sa.Column('is_remote', sa.Boolean(), nullable=True),
    sa.Column('job_type', sa.String(), nullable=True),
    sa.Column('hours_old', sa.Integer(), nullable=True),
    sa.Column('results_wanted', sa.Integer(), nullable=True),
    sa.Column('title_include_keywords', sa.JSON(), nullable=True),
    sa.Column('title_exclude_keywords', sa.JSON(), nullable=True),
    sa.Column('company_filter', sa.JSON(), nullable=True),
    sa.Column('company_exclude', sa.JSON(), nullable=True),
    sa.Column('max_pages', sa.Integer(), nullable=True),
    sa.Column('min_fit_score', sa.Integer(), nullable=True),
    sa.Column('require_salary', sa.Boolean(), nullable=True),
    sa.Column('auto_scoring_depth', sa.String(), nullable=True),
    sa.Column('run_interval_minutes', sa.Integer(), nullable=True),
    sa.Column('exclude_active_companies', sa.Boolean(), nullable=True),
    sa.Column('last_run_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('warning_acknowledged_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('settings',
    sa.Column('key', sa.String(), nullable=False),
    sa.Column('value', sa.Text(), nullable=False),
    sa.Column('description', sa.String(), nullable=True),
    sa.PrimaryKeyConstraint('key')
    )
    op.create_table('visa_cache',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('name_key', sa.String(), nullable=False),
    sa.Column('country', sa.String(), nullable=False),
    sa.Column('display_name', sa.String(), nullable=True),
    sa.Column('slug', sa.String(), nullable=True),
    sa.Column('lca_count', sa.Integer(), nullable=True),
    sa.Column('approval_rate', sa.Float(), nullable=True),
    sa.Column('median_salary', sa.Integer(), nullable=True),
    sa.Column('has_data', sa.Boolean(), nullable=True),
    sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_error', sa.String(), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name_key', 'country', name='uq_visa_cache_name_country')
    )
    op.create_index(op.f('ix_visa_cache_name_key'), 'visa_cache', ['name_key'], unique=False)
    op.create_table('jobs',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('short_id', sa.Integer(), server_default=sa.text("nextval('jobs_short_id_seq')"), nullable=True),
    sa.Column('external_id', sa.String(), nullable=False),
    sa.Column('content_hash', sa.String(), nullable=True),
    sa.Column('linkedin_job_id', sa.String(), nullable=True),
    sa.Column('company', sa.String(), nullable=True),
    sa.Column('title', sa.String(), nullable=True),
    sa.Column('url', sa.String(), nullable=True),
    sa.Column('source', sa.String(), nullable=True),
    sa.Column('search_id', sa.UUID(), nullable=True),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('location', sa.String(), nullable=True),
    sa.Column('loc_country', sa.String(length=2), nullable=True),
    sa.Column('loc_region', sa.String(length=64), nullable=True),
    sa.Column('loc_city', sa.String(length=120), nullable=True),
    sa.Column('arr_remote', sa.Boolean(), nullable=True),
    sa.Column('arr_hybrid', sa.Boolean(), nullable=True),
    sa.Column('arr_onsite', sa.Boolean(), nullable=True),
    sa.Column('remote', sa.Boolean(), nullable=True),
    sa.Column('salary_min', sa.Integer(), nullable=True),
    sa.Column('salary_max', sa.Integer(), nullable=True),
    sa.Column('salary_source', sa.String(), nullable=True),
    sa.Column('h1b_company_lca_count', sa.Integer(), nullable=True),
    sa.Column('h1b_company_approval_rate', sa.Float(), nullable=True),
    sa.Column('h1b_jd_flag', sa.Boolean(), nullable=True),
    sa.Column('h1b_jd_snippet', sa.String(), nullable=True),
    sa.Column('h1b_verdict', sa.String(), nullable=True),
    sa.Column('cv_scores', sa.JSON(), nullable=True),
    sa.Column('best_cv_score', sa.Float(), nullable=True),
    sa.Column('best_cv', sa.String(), nullable=True),
    sa.Column('scoring_report', sa.JSON(), nullable=True),
    sa.Column('cached_page_html', sa.Text(), nullable=True),
    sa.Column('cached_page_text', sa.Text(), nullable=True),
    sa.Column('page_cached_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('cache_error', sa.Text(), nullable=True),
    sa.Column('seen', sa.Boolean(), nullable=True),
    sa.Column('saved', sa.Boolean(), nullable=True),
    sa.Column('status', sa.String(), nullable=True),
    sa.Column('discovered_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['search_id'], ['searches.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('external_id')
    )
    op.create_index(op.f('ix_jobs_arr_hybrid'), 'jobs', ['arr_hybrid'], unique=False)
    op.create_index(op.f('ix_jobs_arr_onsite'), 'jobs', ['arr_onsite'], unique=False)
    op.create_index(op.f('ix_jobs_arr_remote'), 'jobs', ['arr_remote'], unique=False)
    op.create_index(op.f('ix_jobs_best_cv_score'), 'jobs', ['best_cv_score'], unique=False)
    op.create_index(op.f('ix_jobs_content_hash'), 'jobs', ['content_hash'], unique=False)
    op.create_index(op.f('ix_jobs_linkedin_job_id'), 'jobs', ['linkedin_job_id'], unique=False)
    op.create_index(op.f('ix_jobs_loc_city'), 'jobs', ['loc_city'], unique=False)
    op.create_index(op.f('ix_jobs_loc_country'), 'jobs', ['loc_country'], unique=False)
    op.create_index(op.f('ix_jobs_loc_region'), 'jobs', ['loc_region'], unique=False)
    op.create_index(op.f('ix_jobs_short_id'), 'jobs', ['short_id'], unique=True)
    op.create_table('scrape_log',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('search_id', sa.UUID(), nullable=True),
    sa.Column('company_id', sa.UUID(), nullable=True),
    sa.Column('source', sa.String(), nullable=True),
    sa.Column('jobs_found', sa.Integer(), nullable=True),
    sa.Column('new_jobs', sa.Integer(), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('is_warning', sa.Boolean(), nullable=True),
    sa.Column('source_breakdown', sa.JSON(), nullable=True),
    sa.Column('duration_seconds', sa.Float(), nullable=True),
    sa.Column('ran_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['search_id'], ['searches.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('applications',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('job_id', sa.UUID(), nullable=False),
    sa.Column('status', sa.String(), nullable=True),
    sa.Column('applied_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('cv_version_used', sa.String(), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('next_action', sa.String(), nullable=True),
    sa.Column('next_action_date', sa.Date(), nullable=True),
    sa.Column('last_email_received', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_email_snippet', sa.Text(), nullable=True),
    sa.Column('status_transitions', sa.JSON(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['job_id'], ['jobs.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('job_locations',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('job_id', sa.UUID(), nullable=False),
    sa.Column('country', sa.String(length=2), nullable=True),
    sa.Column('region', sa.String(length=64), nullable=True),
    sa.Column('city', sa.String(length=120), nullable=True),
    sa.Column('is_primary', sa.Boolean(), nullable=False),
    sa.ForeignKeyConstraint(['job_id'], ['jobs.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('job_id', 'country', 'region', 'city', name='uq_job_location')
    )
    op.create_index(op.f('ix_job_locations_city'), 'job_locations', ['city'], unique=False)
    op.create_index(op.f('ix_job_locations_country'), 'job_locations', ['country'], unique=False)
    op.create_index(op.f('ix_job_locations_job_id'), 'job_locations', ['job_id'], unique=False)
    op.create_index(op.f('ix_job_locations_region'), 'job_locations', ['region'], unique=False)
    op.create_table('job_runs',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('job_type', sa.String(), nullable=False),
    sa.Column('trigger', sa.String(), nullable=False),
    sa.Column('status', sa.String(), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('duration_seconds', sa.Float(), nullable=True),
    sa.Column('result_summary', sa.Text(), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('meta', sa.JSON(), nullable=True),
    sa.Column('target_job_id', sa.UUID(), nullable=True),
    sa.ForeignKeyConstraint(['target_job_id'], ['jobs.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_job_runs_job_type', 'job_runs', ['job_type'], unique=False)
    op.create_index('ix_job_runs_started_at', 'job_runs', ['started_at'], unique=False)
    op.create_index('ix_job_runs_target_job_id', 'job_runs', ['target_job_id'], unique=False)
    op.create_table('llm_call_log',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('purpose', sa.String(), nullable=False),
    sa.Column('provider', sa.String(), nullable=False),
    sa.Column('job_id', sa.UUID(), nullable=True),
    sa.Column('model', sa.String(), nullable=False),
    sa.Column('input_tokens', sa.Integer(), nullable=False),
    sa.Column('output_tokens', sa.Integer(), nullable=False),
    sa.Column('cache_read_tokens', sa.Integer(), nullable=False),
    sa.Column('cache_write_tokens', sa.Integer(), nullable=False),
    sa.Column('cost_usd', sa.Float(), nullable=False),
    sa.Column('duration_ms', sa.Integer(), nullable=False),
    sa.Column('success', sa.Boolean(), nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['job_id'], ['jobs.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_llm_call_log_created_at', 'llm_call_log', ['created_at'], unique=False)
    op.create_index('ix_llm_call_log_job_id', 'llm_call_log', ['job_id'], unique=False)
    op.create_index('ix_llm_call_log_purpose', 'llm_call_log', ['purpose'], unique=False)
    op.create_table('resumes',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('is_base', sa.Boolean(), nullable=True),
    sa.Column('parent_id', sa.UUID(), nullable=True),
    sa.Column('job_id', sa.UUID(), nullable=True),
    sa.Column('template', sa.String(), nullable=True),
    sa.Column('page_format', sa.String(), nullable=True),
    sa.Column('json_data', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['job_id'], ['jobs.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['parent_id'], ['resumes.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('cover_letters',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('job_id', sa.UUID(), nullable=True),
    sa.Column('resume_id', sa.UUID(), nullable=True),
    sa.Column('parent_id', sa.UUID(), nullable=True),
    sa.Column('template', sa.String(), nullable=True),
    sa.Column('page_format', sa.String(), nullable=True),
    sa.Column('json_data', sa.JSON(), nullable=True),
    sa.Column('voice', sa.String(), nullable=True),
    sa.Column('length', sa.String(), nullable=True),
    sa.Column('from_persona', sa.Boolean(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['job_id'], ['jobs.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['parent_id'], ['cover_letters.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['resume_id'], ['resumes.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('interviews',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('application_id', sa.UUID(), nullable=False),
    sa.Column('what', sa.String(), nullable=False),
    sa.Column('when_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('where_text', sa.String(), nullable=True),
    sa.Column('status', sa.String(), nullable=True),
    sa.Column('prep', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['application_id'], ['applications.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_interviews_application_id'), 'interviews', ['application_id'], unique=False)
    op.create_table('tracer_links',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('token', sa.String(length=10), nullable=False),
    sa.Column('resume_id', sa.UUID(), nullable=True),
    sa.Column('cover_letter_id', sa.UUID(), nullable=True),
    sa.Column('destination_url', sa.String(), nullable=False),
    sa.Column('source_label', sa.String(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['cover_letter_id'], ['cover_letters.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['resume_id'], ['resumes.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_tracer_links_token'), 'tracer_links', ['token'], unique=True)
    # Redundant with the unique index above, but the old startup path created it (seed.run_migrations),
    # so existing databases have it and the baseline must match them.
    op.create_index('idx_tracer_links_token', 'tracer_links', ['token'], unique=False)
    op.create_table('tracer_click_events',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tracer_link_id', sa.UUID(), nullable=False),
    sa.Column('clicked_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('device_type', sa.String(), nullable=True),
    sa.Column('ua_family', sa.String(), nullable=True),
    sa.Column('os_family', sa.String(), nullable=True),
    sa.Column('referrer_host', sa.String(), nullable=True),
    sa.Column('ip_hash', sa.String(), nullable=True),
    sa.Column('is_likely_bot', sa.Boolean(), nullable=True),
    sa.ForeignKeyConstraint(['tracer_link_id'], ['tracer_links.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_table('tracer_click_events')
    op.drop_index(op.f('ix_tracer_links_token'), table_name='tracer_links')
    op.drop_table('tracer_links')
    op.drop_index(op.f('ix_interviews_application_id'), table_name='interviews')
    op.drop_table('interviews')
    op.drop_table('cover_letters')
    op.drop_table('resumes')
    op.drop_index('ix_llm_call_log_purpose', table_name='llm_call_log')
    op.drop_index('ix_llm_call_log_job_id', table_name='llm_call_log')
    op.drop_index('ix_llm_call_log_created_at', table_name='llm_call_log')
    op.drop_table('llm_call_log')
    op.drop_index('ix_job_runs_target_job_id', table_name='job_runs')
    op.drop_index('ix_job_runs_started_at', table_name='job_runs')
    op.drop_index('ix_job_runs_job_type', table_name='job_runs')
    op.drop_table('job_runs')
    op.drop_index(op.f('ix_job_locations_region'), table_name='job_locations')
    op.drop_index(op.f('ix_job_locations_job_id'), table_name='job_locations')
    op.drop_index(op.f('ix_job_locations_country'), table_name='job_locations')
    op.drop_index(op.f('ix_job_locations_city'), table_name='job_locations')
    op.drop_table('job_locations')
    op.drop_table('applications')
    op.drop_table('scrape_log')
    op.drop_index(op.f('ix_jobs_short_id'), table_name='jobs')
    op.drop_index(op.f('ix_jobs_loc_region'), table_name='jobs')
    op.drop_index(op.f('ix_jobs_loc_country'), table_name='jobs')
    op.drop_index(op.f('ix_jobs_loc_city'), table_name='jobs')
    op.drop_index(op.f('ix_jobs_linkedin_job_id'), table_name='jobs')
    op.drop_index(op.f('ix_jobs_content_hash'), table_name='jobs')
    op.drop_index(op.f('ix_jobs_best_cv_score'), table_name='jobs')
    op.drop_index(op.f('ix_jobs_arr_remote'), table_name='jobs')
    op.drop_index(op.f('ix_jobs_arr_onsite'), table_name='jobs')
    op.drop_index(op.f('ix_jobs_arr_hybrid'), table_name='jobs')
    op.drop_table('jobs')
    op.drop_index(op.f('ix_visa_cache_name_key'), table_name='visa_cache')
    op.drop_table('visa_cache')
    op.drop_table('settings')
    op.drop_table('searches')
    op.drop_table('personas')
    op.drop_table('companies')
    op.drop_table('activity_log_v2')
    op.execute("DROP SEQUENCE IF EXISTS jobs_short_id_seq")
    # ### end Alembic commands ###
