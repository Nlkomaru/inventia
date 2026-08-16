CREATE TABLE `integration_credentials` (
	`provider` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`initialization_vector` text NOT NULL,
	`encryption_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "ck_integration_credentials_provider" CHECK("integration_credentials"."provider" = 'openrouter'),
	CONSTRAINT "ck_integration_credentials_encryption_version" CHECK("integration_credentials"."encryption_version" = 1),
	CONSTRAINT "ck_integration_credentials_ciphertext_not_empty" CHECK(length("integration_credentials"."ciphertext") > 0),
	CONSTRAINT "ck_integration_credentials_iv_not_empty" CHECK(length("integration_credentials"."initialization_vector") > 0)
);
