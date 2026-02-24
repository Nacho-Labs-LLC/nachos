/**
 * Composio tool schemas for LLM tool calling
 * 
 * These tools enable the LLM to execute actions via Composio's SDK
 * for various productivity and communication apps.
 */

import type { ToolCall, ToolResult } from '@nachos/types';
import type { StateLayer, StateOperationContext } from '@nachos/state';
import { Composio } from '@composio/core';
import { createLogger } from '@nachos/types';

const logger = createLogger('composio-tools');

/**
 * Allowed apps for Composio integration
 * Matches the configuration schema
 */
const DEFAULT_ALLOWED_APPS = [
  'gmail',
  'googlecalendar',
  'googledocs',
  'googlemeet',
  'googledrive',
  'linkedin',
];

/**
 * composio tool schema
 * Executes actions via Composio SDK
 */
export const ComposioToolSchema = {
  $id: 'composio',
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'The Composio action to execute (e.g., "GMAIL_SEND_EMAIL", "GOOGLECALENDAR_CREATE_EVENT")',
    },
    app: {
      type: 'string',
      enum: DEFAULT_ALLOWED_APPS,
      description: 'App name: gmail, googlecalendar, googledocs, googlemeet, googledrive, linkedin',
    },
    params: {
      type: 'object',
      description: 'Action-specific parameters as a JSON object',
      additionalProperties: true,
    },
  },
  required: ['action', 'app', 'params'],
};

/**
 * Composio client singleton
 */
let composioClient: Composio | null = null;
let composioConfig: {
  apiKey: string;
  entityId: string;
  allowedApps: string[];
} | null = null;

/**
 * Initialize Composio client with config
 */
export function initComposioClient(config: {
  apiKey: string;
  entityId: string;
  allowedApps?: string[];
}): void {
  composioConfig = {
    apiKey: config.apiKey,
    entityId: config.entityId,
    allowedApps: config.allowedApps ?? DEFAULT_ALLOWED_APPS,
  };

  composioClient = new Composio({
    apiKey: config.apiKey,
  });

  logger.info('Composio client initialized', {
    entityId: config.entityId,
    allowedApps: composioConfig.allowedApps,
  });
}

/**
 * Get the Composio client instance
 */
function getComposioClient(): Composio {
  if (!composioClient || !composioConfig) {
    throw new Error(
      'Composio client not initialized. Set COMPOSIO_API_KEY in environment and enable in config.'
    );
  }
  return composioClient;
}

/**
 * Get Composio configuration
 */
function getComposioConfig() {
  if (!composioConfig) {
    throw new Error('Composio not configured');
  }
  return composioConfig;
}

/**
 * Execute composio tool
 * 
 * Executes a Composio action via the SDK
 */
export async function executeComposio(
  call: ToolCall,
  _stateLayer: StateLayer,
  context: StateOperationContext
): Promise<ToolResult> {
  try {
    const params = call.parameters as {
      action?: string;
      app?: string;
      params?: Record<string, unknown>;
    };

    // Validate required parameters
    if (!params.action || typeof params.action !== 'string') {
      return {
        success: false,
        content: [],
        error: {
          code: 'INVALID_PARAMETERS',
          message: 'action parameter is required and must be a string',
        },
      };
    }

    if (!params.app || typeof params.app !== 'string') {
      return {
        success: false,
        content: [],
        error: {
          code: 'INVALID_PARAMETERS',
          message: 'app parameter is required and must be a string',
        },
      };
    }

    if (!params.params || typeof params.params !== 'object') {
      return {
        success: false,
        content: [],
        error: {
          code: 'INVALID_PARAMETERS',
          message: 'params parameter is required and must be an object',
        },
      };
    }

    const config = getComposioConfig();

    // Validate app is in allowed list
    if (!config.allowedApps.includes(params.app)) {
      return {
        success: false,
        content: [],
        error: {
          code: 'APP_NOT_ALLOWED',
          message: `App "${params.app}" is not in the allowed apps list: ${config.allowedApps.join(', ')}`,
        },
      };
    }

    const client = getComposioClient();

    logger.info('Executing Composio action', {
      action: params.action,
      app: params.app,
      entityId: config.entityId,
      userId: context.userId,
    });

    // Execute the action via Composio SDK
    try {
      const result = await client.actions.execute({
        actionName: params.action,
        params: params.params,
        entityId: config.entityId,
      });

      logger.info('Composio action executed successfully', {
        action: params.action,
        app: params.app,
      });

      // Format the result for the LLM
      const resultText = typeof result === 'string'
        ? result
        : JSON.stringify(result, null, 2);

      return {
        success: true,
        content: [
          {
            type: 'text',
            text: `✅ Successfully executed ${params.action} on ${params.app}\n\nResult:\n${resultText}`,
          },
        ],
      };
    } catch (execError) {
      const error = execError as Error;
      logger.error('Composio action execution failed', {
        action: params.action,
        app: params.app,
        error: error.message,
      });

      return {
        success: false,
        content: [],
        error: {
          code: 'COMPOSIO_EXECUTION_FAILED',
          message: `Failed to execute ${params.action}: ${error.message}`,
        },
      };
    }
  } catch (error) {
    logger.error('Composio tool error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      success: false,
      content: [],
      error: {
        code: 'COMPOSIO_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error during Composio execution',
      },
    };
  }
}
