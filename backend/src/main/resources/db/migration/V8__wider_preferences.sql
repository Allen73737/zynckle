-- Room for saved board views in user preferences (was 2,000 characters).
-- SET DATA TYPE is understood by both PostgreSQL and H2.
ALTER TABLE app_user ALTER COLUMN preferences SET DATA TYPE VARCHAR(16000);
