CREATE TABLE `army_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`faction_id` text NOT NULL,
	`roster` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
