CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"tags" text[] DEFAULT '{}',
	"model_config" jsonb NOT NULL,
	"memory_mode" varchar(20) DEFAULT 'stateless' NOT NULL,
	"isolation_level" varchar(20) DEFAULT 'shared' NOT NULL,
	"can_spawn_sub_agents" boolean DEFAULT false NOT NULL,
	"max_sub_agents" integer,
	"skills" text[] DEFAULT '{}',
	"allowed_mcp_tools" text[] DEFAULT '{}',
	"integration" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(20) NOT NULL,
	"integration" varchar(50) NOT NULL,
	"encrypted_data" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"level" varchar(10) NOT NULL,
	"source" varchar(100) NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"workflow_run_id" uuid,
	"agent_id" uuid,
	"node_execution_id" uuid
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"transport" varchar(20) NOT NULL,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"input_schema" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"node_id" varchar(100) NOT NULL,
	"agent_id" uuid,
	"status" varchar(20) NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"type" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"tags" text[] DEFAULT '{}',
	"source" varchar(20) DEFAULT 'user' NOT NULL,
	"parameters" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"agent_id" uuid,
	"workflow_run_id" uuid,
	"provider" varchar(50) NOT NULL,
	"model" varchar(100) NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"estimated_cost_usd" numeric(10, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid,
	"status" varchar(20) NOT NULL,
	"trigger_type" varchar(20) NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"nodes" jsonb NOT NULL,
	"edges" jsonb NOT NULL,
	"triggers" jsonb DEFAULT '[]'::jsonb,
	"error_strategy" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_executions" ADD CONSTRAINT "node_executions_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_executions" ADD CONSTRAINT "node_executions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agents_tags" ON "agents" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "idx_logs_timestamp" ON "logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_logs_workflow_run" ON "logs" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "idx_logs_level" ON "logs" USING btree ("level");--> statement-breakpoint
CREATE INDEX "idx_mcp_tools_server" ON "mcp_tools" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "idx_node_executions_run" ON "node_executions" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "idx_skills_tags" ON "skills" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "idx_usage_timestamp" ON "usage_records" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_usage_agent" ON "usage_records" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_usage_workflow" ON "usage_records" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_runs_workflow" ON "workflow_runs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_runs_status" ON "workflow_runs" USING btree ("status");