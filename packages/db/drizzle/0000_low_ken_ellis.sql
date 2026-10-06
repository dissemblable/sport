CREATE TYPE "public"."biological_sex" AS ENUM('male', 'female', 'unspecified');--> statement-breakpoint
CREATE TYPE "public"."equipment_code" AS ENUM('bodyweight', 'pull_up_bar', 'dumbbells', 'resistance_bands');--> statement-breakpoint
CREATE TYPE "public"."exercise_preference" AS ENUM('favorite', 'disliked', 'banned');--> statement-breakpoint
CREATE TYPE "public"."experience_level" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."fatigue_source" AS ENUM('training', 'soreness_report', 'manual', 'illness');--> statement-breakpoint
CREATE TYPE "public"."fatigue_status" AS ENUM('fresh', 'ready', 'recovering', 'fatigued', 'overreached');--> statement-breakpoint
CREATE TYPE "public"."mechanic" AS ENUM('compound', 'isolation');--> statement-breakpoint
CREATE TYPE "public"."mesocycle_phase" AS ENUM('accumulation', 'intensification', 'deload');--> statement-breakpoint
CREATE TYPE "public"."mesocycle_status" AS ENUM('active', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."movement_pattern" AS ENUM('horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'squat', 'hinge', 'lunge', 'core_antiextension', 'core_flexion', 'core_rotation', 'isolation_upper', 'isolation_lower');--> statement-breakpoint
CREATE TYPE "public"."muscle_code" AS ENUM('chest', 'lats', 'upper_back', 'lower_back', 'front_delts', 'side_delts', 'rear_delts', 'biceps', 'triceps', 'forearms', 'quads', 'hamstrings', 'glutes', 'adductors', 'calves', 'abs', 'obliques');--> statement-breakpoint
CREATE TYPE "public"."muscle_region" AS ENUM('upper_push', 'upper_pull', 'lower', 'core');--> statement-breakpoint
CREATE TYPE "public"."muscle_role" AS ENUM('primary', 'secondary', 'stabilizer');--> statement-breakpoint
CREATE TYPE "public"."muscle_size_class" AS ENUM('large', 'medium', 'small');--> statement-breakpoint
CREATE TYPE "public"."pr_type" AS ENUM('max_reps', 'max_load', 'estimated_1rm', 'max_hold_seconds');--> statement-breakpoint
CREATE TYPE "public"."progression_axis" AS ENUM('reps', 'load', 'band_level', 'leverage', 'tempo', 'unilateral');--> statement-breakpoint
CREATE TYPE "public"."session_block" AS ENUM('warmup', 'main', 'accessory', 'core', 'finisher');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('planned', 'completed', 'skipped', 'missed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."split_type" AS ENUM('full_body', 'upper_lower', 'push_pull_legs', 'push_pull_legs_upper_lower', 'push_pull_legs_x2');--> statement-breakpoint
CREATE TYPE "public"."training_goal" AS ENUM('hypertrophy', 'strength', 'recomposition', 'maintenance');--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" "equipment_code" NOT NULL,
	"name_fr" text NOT NULL,
	"description" text,
	CONSTRAINT "equipment_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "exercise_equipment" (
	"exercise_id" integer NOT NULL,
	"equipment_id" integer NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	CONSTRAINT "exercise_equipment_exercise_id_equipment_id_pk" PRIMARY KEY("exercise_id","equipment_id")
);
--> statement-breakpoint
CREATE TABLE "exercise_muscles" (
	"exercise_id" integer NOT NULL,
	"muscle_id" integer NOT NULL,
	"role" "muscle_role" NOT NULL,
	"contribution" numeric(3, 2) NOT NULL,
	CONSTRAINT "exercise_muscles_exercise_id_muscle_id_pk" PRIMARY KEY("exercise_id","muscle_id")
);
--> statement-breakpoint
CREATE TABLE "exercise_progressions" (
	"from_exercise_id" integer NOT NULL,
	"to_exercise_id" integer NOT NULL,
	"criteria" jsonb,
	CONSTRAINT "exercise_progressions_from_exercise_id_to_exercise_id_pk" PRIMARY KEY("from_exercise_id","to_exercise_id")
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" integer PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name_fr" text NOT NULL,
	"pattern" "movement_pattern" NOT NULL,
	"mechanic" "mechanic" NOT NULL,
	"difficulty" smallint NOT NULL,
	"is_unilateral" boolean DEFAULT false NOT NULL,
	"systemic_load" numeric(4, 2) DEFAULT '1' NOT NULL,
	"default_rep_min" smallint NOT NULL,
	"default_rep_max" smallint NOT NULL,
	"default_rest_seconds" smallint NOT NULL,
	"progression_axes" "progression_axis"[] DEFAULT '{}' NOT NULL,
	"progression_family" text,
	"progression_rank" smallint DEFAULT 1 NOT NULL,
	"setup_notes" text,
	"execution_cues" text[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "exercises_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "muscles" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" "muscle_code" NOT NULL,
	"name_fr" text NOT NULL,
	"region" "muscle_region" NOT NULL,
	"size_class" "muscle_size_class" NOT NULL,
	"recovery_half_life_hours" numeric(5, 2) NOT NULL,
	"min_rest_hours" smallint DEFAULT 48 NOT NULL,
	"full_recovery_hours" smallint DEFAULT 72 NOT NULL,
	"weekly_mev" smallint NOT NULL,
	"weekly_mav" smallint NOT NULL,
	"weekly_mrv" smallint NOT NULL,
	"max_sets_per_session" smallint NOT NULL,
	"display_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "muscles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "body_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"weight_kg" numeric(5, 1),
	"measurements" jsonb DEFAULT '{}'::jsonb,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "user_equipment" (
	"user_id" uuid NOT NULL,
	"equipment_id" integer NOT NULL,
	"code" "equipment_code" NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "user_equipment_user_id_equipment_id_pk" PRIMARY KEY("user_id","equipment_id")
);
--> statement-breakpoint
CREATE TABLE "user_exercise_preferences" (
	"user_id" uuid NOT NULL,
	"exercise_id" integer NOT NULL,
	"status" "exercise_preference" NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_exercise_preferences_user_id_exercise_id_pk" PRIMARY KEY("user_id","exercise_id")
);
--> statement-breakpoint
CREATE TABLE "user_muscle_settings" (
	"user_id" uuid NOT NULL,
	"muscle_id" integer NOT NULL,
	"priority" numeric(3, 2) DEFAULT '1' NOT NULL,
	"min_rest_hours_override" smallint,
	"weekly_sets_override" numeric(5, 2),
	"is_excluded" boolean DEFAULT false NOT NULL,
	"note" text,
	CONSTRAINT "user_muscle_settings_user_id_muscle_id_pk" PRIMARY KEY("user_id","muscle_id")
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"birth_year" smallint,
	"sex" "biological_sex" DEFAULT 'unspecified' NOT NULL,
	"height_cm" numeric(5, 1),
	"body_weight_kg" numeric(5, 1),
	"experience_level" "experience_level" DEFAULT 'beginner' NOT NULL,
	"primary_goal" "training_goal" DEFAULT 'hypertrophy' NOT NULL,
	"sessions_per_week" smallint DEFAULT 3 NOT NULL,
	"session_duration_minutes" smallint DEFAULT 60 NOT NULL,
	"preferred_weekdays" smallint[] DEFAULT '{0,2,4}' NOT NULL,
	"deload_every_n_weeks" smallint DEFAULT 5 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_progression_states" (
	"user_id" uuid NOT NULL,
	"exercise_id" integer NOT NULL,
	"current_load_kg" numeric(6, 2),
	"current_band_level" text,
	"current_rep_target" smallint NOT NULL,
	"consecutive_successes" smallint DEFAULT 0 NOT NULL,
	"consecutive_failures" smallint DEFAULT 0 NOT NULL,
	"estimated_one_rep_max" numeric(6, 2),
	"last_performed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_progression_states_user_id_exercise_id_pk" PRIMARY KEY("user_id","exercise_id")
);
--> statement-breakpoint
CREATE TABLE "mesocycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"duration_weeks" smallint DEFAULT 5 NOT NULL,
	"status" "mesocycle_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "personal_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"exercise_id" integer NOT NULL,
	"type" "pr_type" NOT NULL,
	"value" numeric(8, 2) NOT NULL,
	"achieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_set_id" uuid
);
--> statement-breakpoint
CREATE TABLE "planned_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"planned_session_id" uuid NOT NULL,
	"exercise_id" integer NOT NULL,
	"position" smallint NOT NULL,
	"block" "session_block" DEFAULT 'main' NOT NULL,
	"target_sets" smallint NOT NULL,
	"target_rep_min" smallint NOT NULL,
	"target_rep_max" smallint NOT NULL,
	"target_rir" smallint DEFAULT 2 NOT NULL,
	"rest_seconds" smallint DEFAULT 120 NOT NULL,
	"prescription" jsonb NOT NULL,
	"rationale" text
);
--> statement-breakpoint
CREATE TABLE "planned_session_muscles" (
	"planned_session_id" uuid NOT NULL,
	"muscle_code" text NOT NULL,
	"planned_sets" numeric(5, 2) NOT NULL,
	CONSTRAINT "planned_session_muscles_planned_session_id_muscle_code_pk" PRIMARY KEY("planned_session_id","muscle_code")
);
--> statement-breakpoint
CREATE TABLE "planned_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"scheduled_date" date NOT NULL,
	"slot_index" smallint NOT NULL,
	"slot_label" text NOT NULL,
	"mesocycle_week" smallint NOT NULL,
	"phase" "mesocycle_phase" DEFAULT 'accumulation' NOT NULL,
	"status" "session_status" DEFAULT 'planned' NOT NULL,
	"estimated_duration_minutes" smallint DEFAULT 60 NOT NULL,
	"generation_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_session_id" uuid NOT NULL,
	"exercise_id" integer NOT NULL,
	"set_index" smallint NOT NULL,
	"is_warmup" boolean DEFAULT false NOT NULL,
	"reps" smallint,
	"load_kg" numeric(6, 2),
	"band_level" text,
	"rir" numeric(3, 1),
	"to_failure" boolean DEFAULT false NOT NULL,
	"tempo" text,
	"duration_seconds" smallint,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mesocycle_id" uuid NOT NULL,
	"version" smallint DEFAULT 1 NOT NULL,
	"sessions_per_week" smallint NOT NULL,
	"split_type" "split_type" NOT NULL,
	"split_definition" jsonb NOT NULL,
	"weekdays" smallint[] NOT NULL,
	"min_gap_hours" smallint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"change_reason" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"planned_session_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"session_rpe" smallint,
	"notes" text,
	"is_ad_hoc" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "muscle_fatigue_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"muscle_id" integer NOT NULL,
	"workout_session_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"stimulus" numeric(8, 3) NOT NULL,
	"effective_sets" numeric(6, 2) DEFAULT '0' NOT NULL,
	"half_life_hours" numeric(6, 2) NOT NULL,
	"is_direct_work" boolean DEFAULT true NOT NULL,
	"source" "fatigue_source" DEFAULT 'training' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "muscle_fatigue_states" (
	"user_id" uuid NOT NULL,
	"muscle_id" integer NOT NULL,
	"fatigue_score" numeric(8, 3) DEFAULT '0' NOT NULL,
	"fatigue_pct" numeric(6, 3) DEFAULT '0' NOT NULL,
	"status" "fatigue_status" DEFAULT 'fresh' NOT NULL,
	"last_stimulus_at" timestamp with time zone,
	"available_at" timestamp with time zone,
	"fully_recovered_at" timestamp with time zone,
	"weekly_sets" numeric(6, 2) DEFAULT '0' NOT NULL,
	"current_week_sets" numeric(6, 2) DEFAULT '0' NOT NULL,
	"weekly_sets_target" numeric(6, 2) DEFAULT '0' NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "muscle_fatigue_states_user_id_muscle_id_pk" PRIMARY KEY("user_id","muscle_id")
);
--> statement-breakpoint
CREATE TABLE "muscle_soreness_reports" (
	"checkin_id" uuid NOT NULL,
	"muscle_id" integer NOT NULL,
	"soreness" smallint NOT NULL,
	CONSTRAINT "muscle_soreness_reports_checkin_id_muscle_id_pk" PRIMARY KEY("checkin_id","muscle_id")
);
--> statement-breakpoint
CREATE TABLE "recovery_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sleep_hours" numeric(4, 1),
	"sleep_quality" smallint,
	"stress" smallint,
	"energy" smallint,
	"resting_heart_rate" smallint,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "exercise_equipment" ADD CONSTRAINT "exercise_equipment_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_equipment" ADD CONSTRAINT "exercise_equipment_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_muscles" ADD CONSTRAINT "exercise_muscles_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_muscles" ADD CONSTRAINT "exercise_muscles_muscle_id_muscles_id_fk" FOREIGN KEY ("muscle_id") REFERENCES "public"."muscles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_progressions" ADD CONSTRAINT "exercise_progressions_from_exercise_id_exercises_id_fk" FOREIGN KEY ("from_exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_progressions" ADD CONSTRAINT "exercise_progressions_to_exercise_id_exercises_id_fk" FOREIGN KEY ("to_exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_metrics" ADD CONSTRAINT "body_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_equipment" ADD CONSTRAINT "user_equipment_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_equipment" ADD CONSTRAINT "user_equipment_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_exercise_preferences" ADD CONSTRAINT "user_exercise_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_exercise_preferences" ADD CONSTRAINT "user_exercise_preferences_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_muscle_settings" ADD CONSTRAINT "user_muscle_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_muscle_settings" ADD CONSTRAINT "user_muscle_settings_muscle_id_muscles_id_fk" FOREIGN KEY ("muscle_id") REFERENCES "public"."muscles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_progression_states" ADD CONSTRAINT "exercise_progression_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_progression_states" ADD CONSTRAINT "exercise_progression_states_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mesocycles" ADD CONSTRAINT "mesocycles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_session_set_id_session_sets_id_fk" FOREIGN KEY ("session_set_id") REFERENCES "public"."session_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_exercises" ADD CONSTRAINT "planned_exercises_planned_session_id_planned_sessions_id_fk" FOREIGN KEY ("planned_session_id") REFERENCES "public"."planned_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_exercises" ADD CONSTRAINT "planned_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_session_muscles" ADD CONSTRAINT "planned_session_muscles_planned_session_id_planned_sessions_id_fk" FOREIGN KEY ("planned_session_id") REFERENCES "public"."planned_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_plan_id_training_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_sets" ADD CONSTRAINT "session_sets_workout_session_id_workout_sessions_id_fk" FOREIGN KEY ("workout_session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_sets" ADD CONSTRAINT "session_sets_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_mesocycle_id_mesocycles_id_fk" FOREIGN KEY ("mesocycle_id") REFERENCES "public"."mesocycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_planned_session_id_planned_sessions_id_fk" FOREIGN KEY ("planned_session_id") REFERENCES "public"."planned_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muscle_fatigue_events" ADD CONSTRAINT "muscle_fatigue_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muscle_fatigue_events" ADD CONSTRAINT "muscle_fatigue_events_muscle_id_muscles_id_fk" FOREIGN KEY ("muscle_id") REFERENCES "public"."muscles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muscle_fatigue_events" ADD CONSTRAINT "muscle_fatigue_events_workout_session_id_workout_sessions_id_fk" FOREIGN KEY ("workout_session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muscle_fatigue_states" ADD CONSTRAINT "muscle_fatigue_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muscle_fatigue_states" ADD CONSTRAINT "muscle_fatigue_states_muscle_id_muscles_id_fk" FOREIGN KEY ("muscle_id") REFERENCES "public"."muscles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muscle_soreness_reports" ADD CONSTRAINT "muscle_soreness_reports_checkin_id_recovery_checkins_id_fk" FOREIGN KEY ("checkin_id") REFERENCES "public"."recovery_checkins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muscle_soreness_reports" ADD CONSTRAINT "muscle_soreness_reports_muscle_id_muscles_id_fk" FOREIGN KEY ("muscle_id") REFERENCES "public"."muscles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_checkins" ADD CONSTRAINT "recovery_checkins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercise_muscles_muscle_idx" ON "exercise_muscles" USING btree ("muscle_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_progressions_unique_idx" ON "exercise_progressions" USING btree ("from_exercise_id","to_exercise_id");--> statement-breakpoint
CREATE INDEX "exercises_pattern_idx" ON "exercises" USING btree ("pattern");--> statement-breakpoint
CREATE INDEX "exercises_family_idx" ON "exercises" USING btree ("progression_family","progression_rank");--> statement-breakpoint
CREATE INDEX "mesocycles_user_status_idx" ON "mesocycles" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "personal_records_user_exercise_idx" ON "personal_records" USING btree ("user_id","exercise_id");--> statement-breakpoint
CREATE INDEX "planned_exercises_session_idx" ON "planned_exercises" USING btree ("planned_session_id","position");--> statement-breakpoint
CREATE INDEX "planned_sessions_user_date_idx" ON "planned_sessions" USING btree ("user_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "planned_sessions_plan_idx" ON "planned_sessions" USING btree ("plan_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "session_sets_session_idx" ON "session_sets" USING btree ("workout_session_id","set_index");--> statement-breakpoint
CREATE INDEX "session_sets_exercise_time_idx" ON "session_sets" USING btree ("exercise_id","performed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "training_plans_user_active_idx" ON "training_plans" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "training_plans_meso_version_idx" ON "training_plans" USING btree ("mesocycle_id","version");--> statement-breakpoint
CREATE INDEX "workout_sessions_user_time_idx" ON "workout_sessions" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "fatigue_events_user_muscle_time_idx" ON "muscle_fatigue_events" USING btree ("user_id","muscle_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "fatigue_events_session_idx" ON "muscle_fatigue_events" USING btree ("workout_session_id");--> statement-breakpoint
CREATE INDEX "recovery_checkins_user_time_idx" ON "recovery_checkins" USING btree ("user_id","checked_at" DESC NULLS LAST);