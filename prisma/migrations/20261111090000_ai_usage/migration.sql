-- AI calls and tokens per month, for the monthly spending limit.
CREATE TABLE "ai_usage" (
    "month" VARCHAR(7) NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" BIGINT NOT NULL DEFAULT 0,
    "output_tokens" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("month")
);
