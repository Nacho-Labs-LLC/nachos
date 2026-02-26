import { v4 as uuid } from 'uuid';
export class PostgresSessionsStore {
    pool;
    initialized = false;
    schemaPromise = null;
    schema;
    constructor(pool, schema) {
        this.pool = pool;
        this.schema = schema ?? 'public';
    }
    async ensureSchema() {
        if (this.initialized)
            return;
        if (!this.schemaPromise) {
            this.schemaPromise = this.runSchema()
                .then(() => {
                this.initialized = true;
                this.schemaPromise = null;
            })
                .catch((err) => {
                this.schemaPromise = null;
                throw err;
            });
        }
        return this.schemaPromise;
    }
    async runSchema() {
        await this.pool.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
        await this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.qualified('sessions')} (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        system_prompt TEXT,
        config JSONB,
        metadata JSONB,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        is_pinned BOOLEAN DEFAULT false,
        is_archived BOOLEAN DEFAULT false,
        last_activity TEXT NOT NULL,
        UNIQUE(channel, conversation_id)
      )`);
        await this.pool.query(`CREATE INDEX IF NOT EXISTS sessions_channel_conversation_idx 
       ON ${this.qualified('sessions')}(channel, conversation_id)`);
        await this.pool.query(`CREATE INDEX IF NOT EXISTS sessions_active_idx 
       ON ${this.qualified('sessions')}(channel, is_archived, last_activity) 
       WHERE is_archived = false`);
        await this.pool.query(`CREATE INDEX IF NOT EXISTS sessions_archived_idx 
       ON ${this.qualified('sessions')}(channel, is_archived, updated_at) 
       WHERE is_archived = true`);
        await this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.qualified('messages')} (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls JSONB,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES ${this.qualified('sessions')}(id)
      )`);
        await this.pool.query(`CREATE INDEX IF NOT EXISTS messages_session_id_idx 
       ON ${this.qualified('messages')}(session_id)`);
    }
    qualified(table) {
        return `"${this.schema}".${table}`;
    }
    rowToSession(row) {
        return {
            id: row.id,
            channel: row.channel,
            conversationId: row.conversation_id,
            userId: row.user_id,
            status: row.status,
            systemPrompt: row.system_prompt ?? undefined,
            config: row.config ? (typeof row.config === 'string' ? JSON.parse(row.config) : row.config) : {},
            metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : {},
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            isPinned: row.is_pinned,
            isArchived: row.is_archived,
            lastActivity: row.last_activity,
        };
    }
    rowToMessage(row) {
        return {
            id: row.id,
            sessionId: row.session_id,
            role: row.role,
            content: row.content,
            toolCalls: row.tool_calls ? (typeof row.tool_calls === 'string' ? JSON.parse(row.tool_calls) : row.tool_calls) : undefined,
            createdAt: row.created_at,
        };
    }
    async createSession(data) {
        await this.ensureSchema();
        const now = new Date().toISOString();
        const id = uuid();
        await this.pool.query(`INSERT INTO ${this.qualified('sessions')} 
       (id, channel, conversation_id, user_id, status, system_prompt, config, metadata, created_at, updated_at, is_pinned, is_archived, last_activity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`, [
            id,
            data.channel,
            data.conversationId,
            data.userId,
            'active',
            data.systemPrompt ?? null,
            data.config ? JSON.stringify(data.config) : null,
            data.metadata ? JSON.stringify(data.metadata) : null,
            now,
            now,
            false,
            false,
            now,
        ]);
        return {
            id,
            channel: data.channel,
            conversationId: data.conversationId,
            userId: data.userId,
            status: 'active',
            systemPrompt: data.systemPrompt,
            config: data.config ?? {},
            metadata: data.metadata ?? {},
            createdAt: now,
            updatedAt: now,
            isPinned: false,
            isArchived: false,
            lastActivity: now,
        };
    }
    async getOrCreateSessionAtomic(data) {
        await this.ensureSchema();
        const now = new Date().toISOString();
        const id = uuid();
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query(`INSERT INTO ${this.qualified('sessions')} 
         (id, channel, conversation_id, user_id, status, system_prompt, config, metadata, created_at, updated_at, is_pinned, is_archived, last_activity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (channel, conversation_id) 
         DO UPDATE SET 
           status = CASE WHEN ${this.qualified('sessions')}.status = 'active' THEN ${this.qualified('sessions')}.status ELSE 'active' END,
           updated_at = CASE WHEN ${this.qualified('sessions')}.status = 'active' THEN ${this.qualified('sessions')}.updated_at ELSE $10 END,
           last_activity = CASE WHEN ${this.qualified('sessions')}.status = 'active' THEN ${this.qualified('sessions')}.last_activity ELSE $13 END
         RETURNING *, (xmax = 0) AS was_inserted`, [
                id,
                data.channel,
                data.conversationId,
                data.userId,
                'active',
                data.systemPrompt ?? null,
                data.config ? JSON.stringify(data.config) : null,
                data.metadata ? JSON.stringify(data.metadata) : null,
                now,
                now,
                false,
                false,
                now,
            ]);
            const row = result.rows[0];
            const session = this.rowToSession(row);
            await client.query('COMMIT');
            return { session, created: row.was_inserted };
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    async getSession(id) {
        await this.ensureSchema();
        const result = await this.pool.query(`SELECT * FROM ${this.qualified('sessions')} WHERE id = $1`, [id]);
        if (result.rows.length === 0) {
            return null;
        }
        return this.rowToSession(result.rows[0]);
    }
    async getSessionByConversation(channel, conversationId) {
        await this.ensureSchema();
        const result = await this.pool.query(`SELECT * FROM ${this.qualified('sessions')} 
       WHERE channel = $1 AND conversation_id = $2`, [channel, conversationId]);
        if (result.rows.length === 0) {
            return null;
        }
        return this.rowToSession(result.rows[0]);
    }
    async updateSession(id, data) {
        await this.ensureSchema();
        const session = await this.getSession(id);
        if (!session) {
            return null;
        }
        const now = new Date().toISOString();
        const updates = ['updated_at = $1'];
        const values = [now];
        let paramIndex = 2;
        if (data.status !== undefined) {
            updates.push(`status = $${paramIndex++}`);
            values.push(data.status);
        }
        if (data.systemPrompt !== undefined) {
            updates.push(`system_prompt = $${paramIndex++}`);
            values.push(data.systemPrompt);
        }
        if (data.config !== undefined) {
            updates.push(`config = $${paramIndex++}`);
            values.push(JSON.stringify(data.config));
        }
        if (data.metadata !== undefined) {
            updates.push(`metadata = $${paramIndex++}`);
            values.push(JSON.stringify(data.metadata));
        }
        values.push(id);
        await this.pool.query(`UPDATE ${this.qualified('sessions')} 
       SET ${updates.join(', ')} 
       WHERE id = $${paramIndex}`, values);
        return await this.getSession(id);
    }
    async deleteSession(id) {
        await this.ensureSchema();
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`DELETE FROM ${this.qualified('messages')} WHERE session_id = $1`, [id]);
            const result = await client.query(`DELETE FROM ${this.qualified('sessions')} WHERE id = $1`, [id]);
            await client.query('COMMIT');
            return result.rowCount !== null && result.rowCount > 0;
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    async listSessions(options) {
        await this.ensureSchema();
        const conditions = [];
        const values = [];
        let paramIndex = 1;
        if (options?.channel) {
            conditions.push(`channel = $${paramIndex++}`);
            values.push(options.channel);
        }
        if (options?.status) {
            conditions.push(`status = $${paramIndex++}`);
            values.push(options.status);
        }
        let sql = `SELECT * FROM ${this.qualified('sessions')}`;
        if (conditions.length > 0) {
            sql += ` WHERE ${conditions.join(' AND ')}`;
        }
        sql += ' ORDER BY updated_at DESC';
        if (options?.limit) {
            sql += ` LIMIT $${paramIndex++}`;
            values.push(options.limit);
        }
        if (options?.offset) {
            sql += ` OFFSET $${paramIndex++}`;
            values.push(options.offset);
        }
        const result = await this.pool.query(sql, values);
        return result.rows.map((row) => this.rowToSession(row));
    }
    async addMessage(data) {
        await this.ensureSchema();
        const now = new Date().toISOString();
        const id = uuid();
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`INSERT INTO ${this.qualified('messages')} 
         (id, session_id, role, content, tool_calls, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`, [
                id,
                data.sessionId,
                data.role,
                data.content,
                data.toolCalls ? JSON.stringify(data.toolCalls) : null,
                now,
            ]);
            await client.query(`UPDATE ${this.qualified('sessions')} 
         SET updated_at = $1, last_activity = $1 
         WHERE id = $2`, [now, data.sessionId]);
            await client.query('COMMIT');
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
        return {
            id,
            sessionId: data.sessionId,
            role: data.role,
            content: data.content,
            toolCalls: data.toolCalls,
            createdAt: now,
        };
    }
    async getMessages(sessionId, options) {
        await this.ensureSchema();
        let sql = `SELECT * FROM ${this.qualified('messages')} WHERE session_id = $1 ORDER BY created_at ASC`;
        const values = [sessionId];
        let paramIndex = 2;
        if (options?.limit) {
            sql += ` LIMIT $${paramIndex++}`;
            values.push(options.limit);
        }
        if (options?.offset) {
            sql += ` OFFSET $${paramIndex++}`;
            values.push(options.offset);
        }
        const result = await this.pool.query(sql, values);
        return result.rows.map((row) => this.rowToMessage(row));
    }
    async getSessionWithMessages(id) {
        await this.ensureSchema();
        const session = await this.getSession(id);
        if (!session) {
            return null;
        }
        const messages = await this.getMessages(id);
        return { ...session, messages };
    }
    async getMessageCount(sessionId) {
        await this.ensureSchema();
        const result = await this.pool.query(`SELECT COUNT(*) as count FROM ${this.qualified('messages')} WHERE session_id = $1`, [sessionId]);
        return parseInt(result.rows[0].count, 10);
    }
    async replaceMessages(sessionId, messages) {
        await this.ensureSchema();
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`DELETE FROM ${this.qualified('messages')} WHERE session_id = $1`, [sessionId]);
            for (const msg of messages) {
                await client.query(`INSERT INTO ${this.qualified('messages')} 
           (id, session_id, role, content, tool_calls, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`, [
                    msg.id,
                    sessionId,
                    msg.role,
                    msg.content,
                    msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
                    msg.createdAt,
                ]);
            }
            const now = new Date().toISOString();
            await client.query(`UPDATE ${this.qualified('sessions')} 
         SET updated_at = $1 
         WHERE id = $2`, [now, sessionId]);
            await client.query('COMMIT');
            return messages.length;
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    async listActive(options) {
        await this.ensureSchema();
        const conditions = ['is_archived = false'];
        const values = [];
        let paramIndex = 1;
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        conditions.push(`(last_activity >= $${paramIndex++} OR is_pinned = true)`);
        values.push(twentyFourHoursAgo);
        if (options?.channel) {
            conditions.push(`channel = $${paramIndex++}`);
            values.push(options.channel);
        }
        if (options?.userId) {
            conditions.push(`user_id = $${paramIndex++}`);
            values.push(options.userId);
        }
        let sql = `SELECT * FROM ${this.qualified('sessions')} WHERE ${conditions.join(' AND ')}`;
        sql += ' ORDER BY is_pinned DESC, last_activity DESC';
        if (options?.limit) {
            sql += ` LIMIT $${paramIndex++}`;
            values.push(options.limit);
        }
        if (options?.offset) {
            sql += ` OFFSET $${paramIndex++}`;
            values.push(options.offset);
        }
        const result = await this.pool.query(sql, values);
        return result.rows.map((row) => this.rowToSession(row));
    }
    async listArchived(options) {
        await this.ensureSchema();
        const conditions = ['is_archived = true'];
        const values = [];
        let paramIndex = 1;
        if (options?.channel) {
            conditions.push(`channel = $${paramIndex++}`);
            values.push(options.channel);
        }
        if (options?.userId) {
            conditions.push(`user_id = $${paramIndex++}`);
            values.push(options.userId);
        }
        if (options?.search) {
            conditions.push(`(conversation_id ILIKE $${paramIndex} OR system_prompt ILIKE $${paramIndex})`);
            values.push(`%${options.search}%`);
            paramIndex++;
        }
        let sql = `SELECT * FROM ${this.qualified('sessions')} WHERE ${conditions.join(' AND ')}`;
        sql += ' ORDER BY updated_at DESC';
        if (options?.limit) {
            sql += ` LIMIT $${paramIndex++}`;
            values.push(options.limit);
        }
        if (options?.offset) {
            sql += ` OFFSET $${paramIndex++}`;
            values.push(options.offset);
        }
        const result = await this.pool.query(sql, values);
        return result.rows.map((row) => this.rowToSession(row));
    }
    async archive(sessionId) {
        await this.ensureSchema();
        const now = new Date().toISOString();
        const result = await this.pool.query(`UPDATE ${this.qualified('sessions')} 
       SET is_archived = true, updated_at = $1 
       WHERE id = $2`, [now, sessionId]);
        return result.rowCount !== null && result.rowCount > 0;
    }
    async restore(sessionId) {
        await this.ensureSchema();
        const now = new Date().toISOString();
        const result = await this.pool.query(`UPDATE ${this.qualified('sessions')} 
       SET is_archived = false, last_activity = $1, updated_at = $1 
       WHERE id = $2`, [now, sessionId]);
        return result.rowCount !== null && result.rowCount > 0;
    }
    async pin(sessionId, pinned) {
        await this.ensureSchema();
        const now = new Date().toISOString();
        const result = await this.pool.query(`UPDATE ${this.qualified('sessions')} 
       SET is_pinned = $1, updated_at = $2 
       WHERE id = $3`, [pinned, now, sessionId]);
        return result.rowCount !== null && result.rowCount > 0;
    }
    async close() {
    }
}
//# sourceMappingURL=postgres-sessions-store.js.map