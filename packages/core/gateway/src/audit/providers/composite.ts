import type { AuditEvent } from '../types.js';
import type { AuditProvider, AuditQueryFilter } from '../provider.js';

export class CompositeAuditProvider implements AuditProvider {
  readonly name = 'composite';

  constructor(private readonly providers: AuditProvider[]) {}

  async init(): Promise<void> {
    await Promise.all(this.providers.map((provider) => provider.init()));
  }

  async log(event: AuditEvent): Promise<void> {
    await Promise.allSettled(this.providers.map((provider) => provider.log(event)));
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.providers.map((provider) => provider.flush()));
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.providers.map((provider) => provider.close()));
  }

  async query(filter: AuditQueryFilter): Promise<AuditEvent[]> {
    const results = await Promise.all(
      this.providers
        .filter((provider) => typeof provider.query === 'function')
        .map((provider) => provider.query!(filter))
    );
    return results.flat();
  }
}
