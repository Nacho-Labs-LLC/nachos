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
    const suggestion = DockerCommandError.buildSuggestion(stderr);
    super(
      `Docker command failed: ${command}`,
      'DOCKER_COMMAND_FAILED',
      3,
      suggestion ?? `stderr: ${stderr}`
    );
  }

  /**
   * Map known Docker error patterns to actionable suggestions.
   */
  static buildSuggestion(stderr: string): string | undefined {
    const s = stderr.toLowerCase();

    if (
      s.includes('cannot connect to the docker daemon') ||
      s.includes('is the docker daemon running') ||
      s.includes('docker daemon is not running')
    ) {
      return 'Docker daemon is not running. Start Docker Desktop or run: sudo systemctl start docker';
    }

    if (s.includes('permission denied') && s.includes('/var/run/docker.sock')) {
      return 'Permission denied on Docker socket. Add your user to the docker group: sudo usermod -aG docker $USER (then log out and back in)';
    }

    if (s.includes('no such file or directory') && s.includes('docker.sock')) {
      return 'Docker socket not found. Install Docker Desktop or Docker Engine: https://docs.docker.com/get-docker/';
    }

    if (s.includes('pull access denied') || s.includes('unauthorized: authentication required')) {
      return 'Image pull failed — authentication required. Run: docker login';
    }

    if (s.includes('no space left on device')) {
      return 'Disk full. Free space or prune unused images/containers: docker system prune';
    }

    if (s.includes('port is already allocated') || s.includes('address already in use')) {
      return 'A port required by this service is already in use. Stop the conflicting process or change the port in nachos.toml';
    }

    if (s.includes('network') && s.includes('not found')) {
      return 'Docker network not found. Run: docker network prune (or restart Docker)';
    }

    if (s.includes('toomanyrequests') || s.includes('rate limit')) {
      return 'Docker Hub rate limit hit. Authenticate with: docker login (free accounts get higher limits)';
    }

    if (stderr.trim()) {
      return `Docker error: ${stderr.trim()}`;
    }

    return undefined;
  }
}
