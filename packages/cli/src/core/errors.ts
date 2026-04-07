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

/**
 * Known Docker error patterns and their user-friendly suggestions.
 */
const DOCKER_ERROR_SUGGESTIONS: Array<{ pattern: RegExp; suggestion: string }> = [
  {
    pattern:
      /cannot connect to the docker daemon|is the docker daemon running|docker daemon is not running/i,
    suggestion:
      'Docker daemon is not running. Start it with: open -a Docker (macOS) or sudo systemctl start docker (Linux)',
  },
  {
    pattern: /permission denied.*\/var\/run\/docker\.sock/i,
    suggestion:
      'Permission denied accessing Docker socket. Add your user to the docker group: sudo usermod -aG docker $USER (then log out and back in)',
  },
  {
    pattern: /no such file or directory.*docker/i,
    suggestion:
      'Docker binary not found. Install Docker Desktop or Docker Engine: https://docs.docker.com/get-docker/',
  },
  {
    pattern: /pull access denied|manifest unknown|not found/i,
    suggestion:
      'Image could not be pulled. Check the image name/tag and your Docker Hub credentials.',
  },
  {
    pattern: /port is already allocated|address already in use/i,
    suggestion:
      'A required port is already in use. Stop the conflicting service or change the port in nachos.toml.',
  },
  {
    pattern: /no space left on device/i,
    suggestion: 'Disk is full. Free up space or run: docker system prune',
  },
];

function buildDockerSuggestion(stderr: string): string {
  for (const { pattern, suggestion } of DOCKER_ERROR_SUGGESTIONS) {
    if (pattern.test(stderr)) {
      return suggestion;
    }
  }
  // Fallback: show the raw error so users have something to act on
  return `Docker reported: ${stderr.trim() || '(no error output)'}`;
}

export class DockerCommandError extends CLIError {
  constructor(command: string, stderr: string) {
    super(
      `Docker command failed: ${command}`,
      'DOCKER_COMMAND_FAILED',
      3,
      buildDockerSuggestion(stderr)
    );
  }
}
