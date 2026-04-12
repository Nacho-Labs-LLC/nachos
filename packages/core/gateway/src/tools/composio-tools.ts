/**
 * Composio tool for LLM tool calling via REST API
 */

import type { ToolCall, ToolResult } from '@nachos/types';
import type { StateLayer, StateOperationContext } from '@nachos/state';
import { createLogger, createConfigError } from '@nachos/types';

const logger = createLogger('composio-tools');

const DEFAULT_ALLOWED_APPS = [
  'gmail',
  'googlecalendar',
  'googledocs',
  'googlemeet',
  'googledrive',
  'linkedin',
];

export const ComposioToolSchema = {
  $id: 'composio',
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description:
        'The Composio action to execute (e.g., "GMAIL_SEND_EMAIL", "GOOGLECALENDAR_CREATE_EVENT")',
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

let composioConfig: {
  apiKey: string;
  entityId: string;
  allowedApps: string[];
} | null = null;

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

  logger.info(
    {
      entityId: config.entityId,
      allowedApps: composioConfig.allowedApps,
    },
    'Composio client initialized'
  );
}

function getComposioConfig() {
  if (!composioConfig) {
    throw createConfigError('Composio not configured', { component: 'gateway' });
  }
  return composioConfig;
}

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

    logger.info(
      {
        action: params.action,
        app: params.app,
        entityId: config.entityId,
        userId: context.userId,
      },
      'Executing Composio action'
    );

    try {
      const response = await fetch('https://backend.composio.dev/api/v1/actions/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.apiKey,
        },
        body: JSON.stringify({
          actionName: params.action,
          params: params.params,
          entityId: config.entityId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          {
            action: params.action,
            app: params.app,
            status: response.status,
            error: errorText,
          },
          'Composio action execution failed'
        );

        return {
          success: false,
          content: [],
          error: {
            code: 'COMPOSIO_EXECUTION_FAILED',
            message: `Failed to execute ${params.action}: HTTP ${response.status} - ${errorText}`,
          },
        };
      }

      const result = await response.json();

      logger.info(
        {
          action: params.action,
          app: params.app,
        },
        'Composio action executed successfully'
      );

      const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

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
      logger.error(
        {
          action: params.action,
          app: params.app,
          error: error.message,
        },
        'Composio action execution failed'
      );

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
    logger.error(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      'Composio tool error'
    );

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
