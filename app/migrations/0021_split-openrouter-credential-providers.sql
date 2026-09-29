PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_integration_credentials` (
	`provider` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`initialization_vector` text NOT NULL,
	`encryption_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "ck_integration_credentials_provider" CHECK("__new_integration_credentials"."provider" = 'openrouter' OR "__new_integration_credentials"."provider" = 'openrouter-embedding' OR "__new_integration_credentials"."provider" = 'openrouter-vision'),
	CONSTRAINT "ck_integration_credentials_encryption_version" CHECK("__new_integration_credentials"."encryption_version" = 1),
	CONSTRAINT "ck_integration_credentials_ciphertext_not_empty" CHECK(length("__new_integration_credentials"."ciphertext") > 0),
	CONSTRAINT "ck_integration_credentials_iv_not_empty" CHECK(length("__new_integration_credentials"."initialization_vector") > 0)
);
--> statement-breakpoint
INSERT INTO `__new_integration_credentials`("provider", "ciphertext", "initialization_vector", "encryption_version", "created_at", "updated_at") SELECT "provider", "ciphertext", "initialization_vector", "encryption_version", "created_at", "updated_at" FROM `integration_credentials`;--> statement-breakpoint
DROP TABLE `integration_credentials`;--> statement-breakpoint
ALTER TABLE `__new_integration_credentials` RENAME TO `integration_credentials`;--> statement-breakpoint
PRAGMA foreign_keys=ON;