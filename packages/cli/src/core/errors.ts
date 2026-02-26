/**
 * Custom error types for Nachos CLI
 */

export class CLIError extends Error {
  public details?: unknown;

  constructor(
    message: string,
    public readonly code: string,
    public readonly exitCode: number = 1,
    public readonly suggestion?: string
  ) {
    super(message);
    this.name = 'CLIError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ConfigNotFoundError extends CLIError {
  constructor(searchedPaths: string[]) {
    const pathList = searchedPaths.map((p) => `  - ${p}`).join('\n');
    super(
      'No nachos.toml configuration file found',
      'CONFIG_NOT_FOUND',
      2,
      `Run 'nachos init' to create a new project, or set NACHOS_CONFIG_PATH to specify the location.\n\nSearched paths:\n${pathList}`
    );
  }
}

export class DockerNotAvailableError extends CLIError {
  constructor() {
    super(
      'Docker is not available',
      'DOCKER_NOT_AVAILABLE',
      3,
      'Install Docker Desktop or Docker Engine: https://docs.docker.com/get-docker/'
    );
  }
}

export class DockerComposeNotAvailableError extends CLIError {
  constructor() {
    super(
      'Docker Compose V2 is not available',
      'DOCKER_COMPOSE_NOT_AVAILABLE',
      3,
      'Update to Docker Compose V2. Run: docker compose version'
    );
  }
}

export class ConfigValidationError extends CLIError {
  constructor(message: string, details?: unknown) {
    super(
      `Configuration validation failed: ${message}`,
      'CONFIG_VALIDATION_FAILED',
      2,
      'Check your nachos.toml file for errors. Run: nachos config validate'
    );
    if (details) {
      this.details = details;
    }
  }
}

export class ComposeGenerationError extends CLIError {
  constructor(message: string) {
    super(
      `Failed to generate docker-compose file: ${message}`,
      'COMPOSE_GENERATION_FAILED',
      3,
      'Check your nachos.toml configuration and ensure all required fields are present.'
    );
  }
}

export class DockerCommandError extends CLIError {
  constructor(command: string, stderr: string) {
    super(`Docker command failed: ${command}`, 'DOCKER_COMMAND_FAILED', 3, `Error: ${stderr}`);
  }
}
