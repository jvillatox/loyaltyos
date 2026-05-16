import {
  CampaignBudgetExhaustedError,
  CampaignNotActiveError,
  CampaignNotFoundError,
  CampaignOutOfValidityError,
  CampaignUserLimitReachedError,
} from "@loyaltyos/campaigns";
import {
  AlreadyReversedError,
  InsufficientBalanceError,
  TransactionNotFoundError,
} from "@loyaltyos/core";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

function mapError(err: FastifyError | Error): { status: number; body: { error: ApiError } } {
  // Validation
  if (err instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: err.errors,
        },
      },
    };
  }

  // Core domain errors
  if (err instanceof InsufficientBalanceError) {
    return {
      status: 422,
      body: {
        error: {
          code: "INSUFFICIENT_BALANCE",
          message: err.message,
        },
      },
    };
  }

  if (err instanceof TransactionNotFoundError) {
    return {
      status: 404,
      body: {
        error: {
          code: "TRANSACTION_NOT_FOUND",
          message: err.message,
        },
      },
    };
  }

  if (err instanceof AlreadyReversedError) {
    return {
      status: 409,
      body: {
        error: {
          code: "ALREADY_REVERSED",
          message: err.message,
        },
      },
    };
  }

  // Campaign domain errors
  if (err instanceof CampaignNotFoundError) {
    return {
      status: 404,
      body: { error: { code: "CAMPAIGN_NOT_FOUND", message: err.message } },
    };
  }

  if (err instanceof CampaignNotActiveError) {
    return {
      status: 409,
      body: { error: { code: "CAMPAIGN_NOT_ACTIVE", message: err.message } },
    };
  }

  if (err instanceof CampaignBudgetExhaustedError) {
    return {
      status: 422,
      body: { error: { code: "CAMPAIGN_BUDGET_EXHAUSTED", message: err.message } },
    };
  }

  if (err instanceof CampaignUserLimitReachedError) {
    return {
      status: 422,
      body: { error: { code: "CAMPAIGN_USER_LIMIT_REACHED", message: err.message } },
    };
  }

  if (err instanceof CampaignOutOfValidityError) {
    return {
      status: 422,
      body: { error: { code: "CAMPAIGN_OUT_OF_VALIDITY", message: err.message } },
    };
  }

  // Fastify validation
  const fastifyErr = err as FastifyError;
  if (fastifyErr.statusCode) {
    return {
      status: fastifyErr.statusCode,
      body: {
        error: {
          code: fastifyErr.code || "REQUEST_ERROR",
          message: fastifyErr.message,
        },
      },
    };
  }

  // Unknown
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    },
  };
}

export async function errorHandler(
  err: FastifyError | Error,
  _req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { status, body } = mapError(err);
  if (status === 500) {
    _req.log.error(err);
  }
  await reply.status(status).send(body);
}
