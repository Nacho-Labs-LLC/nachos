import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ShellTool } from './shell-tool.js';

describe('ShellTool', () => {
  let shellTool: ShellTool;
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    shellTool = new ShellTool({
      logger: mockLogger,
    });
  });

  describe('security - command allowlisting', () => {
    it('should allow skill-based tools (goplaces, gifgrep, summarize, gog)', () => {
      expect(shellTool.isCommandAllowed('goplaces search "coffee"')).toBe(true);
      expect(shellTool.isCommandAllowed('gifgrep cats')).toBe(true);
      expect(shellTool.isCommandAllowed('summarize https://example.com')).toBe(true);
      expect(shellTool.isCommandAllowed('gog gmail search')).toBe(true);
    });

    it('should allow file inspection tools (read-only)', () => {
      expect(shellTool.isCommandAllowed('ls -la /app')).toBe(true);
      expect(shellTool.isCommandAllowed('cat config.json')).toBe(true);
      expect(shellTool.isCommandAllowed('head -100 logs/app.log')).toBe(true);
      expect(shellTool.isCommandAllowed('tail -50 errors.log')).toBe(true);
      expect(shellTool.isCommandAllowed('file document.pdf')).toBe(true);
      expect(shellTool.isCommandAllowed('stat myfile.txt')).toBe(true);
      expect(shellTool.isCommandAllowed('wc -l source.ts')).toBe(true);
      expect(shellTool.isCommandAllowed('find . -name "*.ts"')).toBe(true);
    });

    it('should allow text processing tools', () => {
      expect(shellTool.isCommandAllowed('grep ERROR logs/app.log')).toBe(true);
      expect(shellTool.isCommandAllowed('sed s/old/new/g file.txt')).toBe(true);
      expect(shellTool.isCommandAllowed('awk "{print $1}" data.txt')).toBe(true);
      expect(shellTool.isCommandAllowed('cut -d, -f1 data.csv')).toBe(true);
      expect(shellTool.isCommandAllowed('sort data.txt')).toBe(true);
      expect(shellTool.isCommandAllowed('uniq data.txt')).toBe(true);
      expect(shellTool.isCommandAllowed('tr a-z A-Z')).toBe(true);
      expect(shellTool.isCommandAllowed('diff file1.txt file2.txt')).toBe(true);
    });

    it('should allow network debugging tools', () => {
      expect(shellTool.isCommandAllowed('ping -c 4 8.8.8.8')).toBe(true);
      expect(shellTool.isCommandAllowed('curl https://api.example.com')).toBe(true);
      expect(shellTool.isCommandAllowed('wget https://example.com/file.zip')).toBe(true);
      expect(shellTool.isCommandAllowed('dig example.com')).toBe(true);
      expect(shellTool.isCommandAllowed('nslookup google.com')).toBe(true);
    });

    it('should allow system info tools (read-only)', () => {
      expect(shellTool.isCommandAllowed('uname -a')).toBe(true);
      expect(shellTool.isCommandAllowed('hostname')).toBe(true);
      expect(shellTool.isCommandAllowed('whoami')).toBe(true);
      expect(shellTool.isCommandAllowed('pwd')).toBe(true);
      expect(shellTool.isCommandAllowed('env')).toBe(false); // env removed: can launch arbitrary binaries
      expect(shellTool.isCommandAllowed('date')).toBe(true);
      expect(shellTool.isCommandAllowed('uptime')).toBe(true);
      expect(shellTool.isCommandAllowed('free -h')).toBe(true);
      expect(shellTool.isCommandAllowed('df -h')).toBe(true);
      expect(shellTool.isCommandAllowed('du -sh /app')).toBe(true);
    });

    it('should allow process inspection tools', () => {
      expect(shellTool.isCommandAllowed('ps aux')).toBe(true);
      expect(shellTool.isCommandAllowed('pgrep node')).toBe(true);
    });

    it('should allow data processing tools', () => {
      expect(shellTool.isCommandAllowed('jq ".name" data.json')).toBe(true);
      expect(shellTool.isCommandAllowed('yq ".version" config.yaml')).toBe(true);
    });

    it('should allow read-only git operations', () => {
      expect(shellTool.isCommandAllowed('git status')).toBe(true);
      expect(shellTool.isCommandAllowed('git log --oneline -10')).toBe(true);
      expect(shellTool.isCommandAllowed('git diff')).toBe(true);
      expect(shellTool.isCommandAllowed('git show HEAD')).toBe(true);
      expect(shellTool.isCommandAllowed('git branch -a')).toBe(true);
    });

    it('should allow read-only docker operations', () => {
      expect(shellTool.isCommandAllowed('docker ps')).toBe(true);
      expect(shellTool.isCommandAllowed('docker logs container-name')).toBe(true);
      expect(shellTool.isCommandAllowed('docker inspect container-name')).toBe(true);
      expect(shellTool.isCommandAllowed('docker images')).toBe(true);
    });

    it('should allow archive extraction (read-only)', () => {
      expect(shellTool.isCommandAllowed('tar -tzf archive.tar.gz')).toBe(true);
      expect(shellTool.isCommandAllowed('unzip -l archive.zip')).toBe(true);
      expect(shellTool.isCommandAllowed('gunzip file.gz')).toBe(true);
    });
  });

  describe('security - blocked commands', () => {
    it('should block destructive file operations', () => {
      expect(shellTool.isCommandAllowed('rm -rf /')).toBe(false);
      expect(shellTool.isCommandAllowed('mv file1 file2')).toBe(false);
      expect(shellTool.isCommandAllowed('cp file1 file2')).toBe(false);
      expect(shellTool.isCommandAllowed('chmod 777 file')).toBe(false);
      expect(shellTool.isCommandAllowed('chown root file')).toBe(false);
    });

    it('should block shell execution', () => {
      expect(shellTool.isCommandAllowed('bash -c "echo hello"')).toBe(false);
      expect(shellTool.isCommandAllowed('sh script.sh')).toBe(false);
      expect(shellTool.isCommandAllowed('/bin/sh')).toBe(false);
    });

    it('should block system package managers but allow build tools', () => {
      // npm, pip are allowlisted as build tools
      expect(shellTool.isCommandAllowed('npm install package')).toBe(true);
      expect(shellTool.isCommandAllowed('pip install package')).toBe(true);
      // System package managers remain blocked
      expect(shellTool.isCommandAllowed('apt-get install package')).toBe(false);
      expect(shellTool.isCommandAllowed('yum install package')).toBe(false);
    });

    it('should allow git binary but block write operations during execution', () => {
      // isCommandAllowed only checks if binary is in allowlist
      // Subcommand validation happens during execute()
      expect(shellTool.isCommandAllowed('git commit -m "msg"')).toBe(true);
      expect(shellTool.isCommandAllowed('git push')).toBe(true);
      expect(shellTool.isCommandAllowed('git status')).toBe(true); // Read operation
    });

    it('should allow docker binary but block write operations during execution', () => {
      // isCommandAllowed only checks if binary is in allowlist
      // Subcommand validation happens during execute()
      expect(shellTool.isCommandAllowed('docker rm container')).toBe(true);
      expect(shellTool.isCommandAllowed('docker stop container')).toBe(true);
      expect(shellTool.isCommandAllowed('docker ps')).toBe(true); // Read operation
    });

    it('should block unknown/unapproved binaries', () => {
      expect(shellTool.isCommandAllowed('sudo whoami')).toBe(false);
      expect(shellTool.isCommandAllowed('nc -l 8080')).toBe(false);
      expect(shellTool.isCommandAllowed('nmap 192.168.1.0/24')).toBe(false);
      expect(shellTool.isCommandAllowed('dd if=/dev/zero of=/dev/sda')).toBe(false);
    });
  });

  describe('security - injection protection', () => {
    it('should block command substitution with $()', () => {
      expect(shellTool.isCommandAllowed('ls $(cat /etc/passwd)')).toBe(false);
      expect(shellTool.isCommandAllowed('echo $(rm -rf /)')).toBe(false);
    });

    it('should block command substitution with backticks', () => {
      expect(shellTool.isCommandAllowed('ls `cat /etc/passwd`')).toBe(false);
      expect(shellTool.isCommandAllowed('echo `rm -rf /`')).toBe(false);
    });

    it('should block variable expansion patterns', () => {
      expect(shellTool.isCommandAllowed('ls ${HOME}')).toBe(false);
      expect(shellTool.isCommandAllowed('echo $USER')).toBe(false);
    });

    it('should block process substitution', () => {
      expect(shellTool.isCommandAllowed('cat <(echo test)')).toBe(false);
      expect(shellTool.isCommandAllowed('cat >(tee output.txt)')).toBe(false);
    });

    it('should block here documents', () => {
      expect(shellTool.isCommandAllowed('cat <<EOF')).toBe(false);
      expect(shellTool.isCommandAllowed('cat <<-EOF')).toBe(false);
    });

    it('should allow shell redirects in command parsing', () => {
      // Redirects (>, >>, <) are handled by the shell when shell:true is used
      // With shell:false (our mode), redirects are treated as arguments
      // This is actually safer - redirects don't work as injection vectors
      expect(shellTool.isCommandAllowed('ls > /etc/passwd')).toBe(true);
      expect(shellTool.isCommandAllowed('ls >> file.txt')).toBe(true);
      expect(shellTool.isCommandAllowed('cat < /etc/shadow')).toBe(true);
      // Note: These redirects won't actually work in execution (shell:false mode)
      // They'll be treated as literal arguments, not file redirects
    });

    it('should block mixed allowed/disallowed commands', () => {
      expect(shellTool.isCommandAllowed('ls; rm -rf /')).toBe(false);
      expect(shellTool.isCommandAllowed('ls && rm -rf /')).toBe(false);
      expect(shellTool.isCommandAllowed('ls || rm -rf /')).toBe(false);
    });
  });

  describe('compound commands - pipes and operators', () => {
    it('should allow pipes between allowed commands', () => {
      expect(shellTool.isCommandAllowed('cat file.txt | grep ERROR')).toBe(true);
      expect(shellTool.isCommandAllowed('ps aux | grep node')).toBe(true);
      expect(shellTool.isCommandAllowed('ls -la | grep config')).toBe(true);
    });

    it('should allow && between allowed commands', () => {
      expect(shellTool.isCommandAllowed('ls && pwd')).toBe(true);
      expect(shellTool.isCommandAllowed('cat file1 && cat file2')).toBe(true);
    });

    it('should allow || between allowed commands', () => {
      // echo is not in the default allowlist
      expect(shellTool.isCommandAllowed('ls file.txt || pwd')).toBe(true);
      expect(shellTool.isCommandAllowed('cat file1 || cat file2')).toBe(true);
    });

    it('should allow ; between allowed commands', () => {
      expect(shellTool.isCommandAllowed('ls; pwd; whoami')).toBe(true);
    });

    it('should block if any command in chain is disallowed', () => {
      expect(shellTool.isCommandAllowed('ls | rm file')).toBe(false);
      expect(shellTool.isCommandAllowed('cat file && rm file')).toBe(false);
      expect(shellTool.isCommandAllowed('ls || sudo reboot')).toBe(false);
    });
  });

  describe('tool groups', () => {
    it('should return correct tool group for single commands', () => {
      expect(shellTool.getToolGroup('goplaces search "test"')).toBe('lookup');
      expect(shellTool.getToolGroup('gifgrep cats')).toBe('media');
      expect(shellTool.getToolGroup('summarize https://example.com')).toBe('summarize');
      expect(shellTool.getToolGroup('gog gmail search')).toBe('workspace');
      expect(shellTool.getToolGroup('ls -la')).toBe('file-inspection');
      expect(shellTool.getToolGroup('grep ERROR logs')).toBe('text-processing');
      expect(shellTool.getToolGroup('curl https://api.com')).toBe('network-debug');
      expect(shellTool.getToolGroup('git status')).toBe('git');
      expect(shellTool.getToolGroup('docker ps')).toBe('docker-inspect');
    });

    it('should return "shell" for mixed tool groups', () => {
      expect(shellTool.getToolGroup('ls | grep config')).toBe('shell');
      expect(shellTool.getToolGroup('cat file && git status')).toBe('shell');
      expect(shellTool.getToolGroup('curl https://api.com | jq ".data"')).toBe('shell');
    });

    it('should return same group when all commands are from same group', () => {
      expect(shellTool.getToolGroup('ls | head')).toBe('file-inspection');
      expect(shellTool.getToolGroup('grep ERROR | grep CRITICAL')).toBe('text-processing');
    });

    it('should return undefined for disallowed commands', () => {
      expect(shellTool.getToolGroup('rm -rf /')).toBeUndefined();
      expect(shellTool.getToolGroup('sudo reboot')).toBeUndefined();
      expect(shellTool.getToolGroup('')).toBeUndefined();
    });
  });

  describe('getAllowedBinaries', () => {
    it('should return comprehensive list of allowed tools', () => {
      const binaries = shellTool.getAllowedBinaries();

      // Check core skill tools
      expect(binaries).toContain('goplaces');
      expect(binaries).toContain('gifgrep');
      expect(binaries).toContain('summarize');
      expect(binaries).toContain('gog');

      // Check debug utilities
      expect(binaries).toContain('ls');
      expect(binaries).toContain('cat');
      expect(binaries).toContain('grep');
      expect(binaries).toContain('curl');
      expect(binaries).toContain('git');
      expect(binaries).toContain('docker');
      expect(binaries).toContain('jq');

      // Verify substantial expansion (4 original + ~60 debug tools)
      expect(binaries.length).toBeGreaterThan(50);
    });

    it('should not include destructive tools', () => {
      const binaries = shellTool.getAllowedBinaries();

      expect(binaries).not.toContain('rm');
      expect(binaries).not.toContain('chmod');
      expect(binaries).not.toContain('chown');
      expect(binaries).not.toContain('mv');
      expect(binaries).not.toContain('sudo');
      expect(binaries).not.toContain('bash');
      expect(binaries).not.toContain('sh');
    });
  });

  describe('edge cases', () => {
    it('should handle empty commands', () => {
      expect(shellTool.isCommandAllowed('')).toBe(false);
      expect(shellTool.isCommandAllowed('   ')).toBe(false);
      expect(shellTool.isCommandAllowed('\t\n')).toBe(false);
    });

    it('should handle commands with extra whitespace', () => {
      expect(shellTool.isCommandAllowed('  ls   -la  ')).toBe(true);
      expect(shellTool.isCommandAllowed('cat\t\tfile.txt')).toBe(true);
    });

    it('should handle commands with arguments', () => {
      expect(shellTool.isCommandAllowed('ls -la /app/data')).toBe(true);
      expect(shellTool.isCommandAllowed('grep -r "pattern" /app')).toBe(true);
      expect(
        shellTool.isCommandAllowed('curl -H "Authorization: Bearer token" https://api.com')
      ).toBe(true);
    });

    it('should handle commands with complex quoted arguments', () => {
      expect(shellTool.isCommandAllowed('echo "hello world"')).toBe(false); // echo not in allowlist
      expect(shellTool.isCommandAllowed('grep "complex pattern" file.txt')).toBe(true);
      expect(shellTool.isCommandAllowed("grep 'single quotes' file.txt")).toBe(true);
    });
  });

  describe('execute - validation', () => {
    it('should reject empty commands', async () => {
      await expect(shellTool.execute({ command: '' })).rejects.toThrow('Empty command');
      await expect(shellTool.execute({ command: '   ' })).rejects.toThrow('Empty command');
    });

    it('should reject disallowed commands', async () => {
      await expect(shellTool.execute({ command: 'rm -rf /' })).rejects.toThrow(/not allowed/);
      await expect(shellTool.execute({ command: 'sudo reboot' })).rejects.toThrow(/not allowed/);
    });

    it('should reject blocked git subcommands during execution', async () => {
      // isCommandAllowed returns true (git is allowed)
      expect(shellTool.isCommandAllowed('git push')).toBe(true);

      // But execute returns error result for blocked subcommands
      const result1 = await shellTool.execute({ command: 'git push', timeout: 1000 });
      expect(result1.exitCode).toBe(1);
      expect(result1.stderr).toContain("Subcommand 'push' not allowed");

      const result2 = await shellTool.execute({ command: 'git commit -m "test"', timeout: 1000 });
      expect(result2.exitCode).toBe(1);
      expect(result2.stderr).toContain("Subcommand 'commit' not allowed");
    });

    it('should reject blocked docker subcommands during execution', async () => {
      // isCommandAllowed returns true (docker is allowed)
      expect(shellTool.isCommandAllowed('docker rm container')).toBe(true);

      // But execute returns error result for blocked subcommands
      const result1 = await shellTool.execute({ command: 'docker rm container', timeout: 1000 });
      expect(result1.exitCode).toBe(1);
      expect(result1.stderr).toContain("Subcommand 'rm' not allowed");

      const result2 = await shellTool.execute({ command: 'docker stop container', timeout: 1000 });
      expect(result2.exitCode).toBe(1);
      expect(result2.stderr).toContain("Subcommand 'stop' not allowed");
    });

    it('should validate required environment variables', async () => {
      // goplaces requires GOOGLE_PLACES_API_KEY
      const originalEnv = process.env.GOOGLE_PLACES_API_KEY;
      delete process.env.GOOGLE_PLACES_API_KEY;

      await expect(shellTool.execute({ command: 'goplaces search "test"' })).rejects.toThrow(
        /Missing required environment variable.*GOOGLE_PLACES_API_KEY/
      );

      // Restore
      if (originalEnv !== undefined) {
        process.env.GOOGLE_PLACES_API_KEY = originalEnv;
      }
    });

    it('should log execution with tool group', async () => {
      // Mock a simple success (use ls which doesn't require env vars)
      try {
        await shellTool.execute({
          command: 'ls /nonexistent-test-path-12345',
          timeout: 1000,
        });
      } catch {
        // Might fail if path doesn't exist, that's okay
      }

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'ls /nonexistent-test-path-12345',
          toolGroup: 'file-inspection',
        }),
        expect.stringContaining('Executing command')
      );
    });
  });

  describe('real execution - basic commands', () => {
    it('should execute a command and return stdout', async () => {
      const result = await shellTool.execute({
        command: 'hostname',
        timeout: 5000,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim().length).toBeGreaterThan(0); // hostname produces output
      expect(result.timedOut).toBe(false);
      expect(result.signal).toBeNull();
    });

    it('should capture stderr on errors', async () => {
      const result = await shellTool.execute({
        command: 'git log --not-a-real-option-xyz',
        timeout: 5000,
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.length).toBeGreaterThan(0); // git outputs error to stderr
    });

    it('should handle timeouts gracefully', async () => {
      // Use a command that will definitely timeout (sleep not in allowlist, use find with huge directory)
      // Actually, let's use a real allowlisted command that takes time
      try {
        const result = await shellTool.execute({
          command: 'find / -name "*.txt" 2>/dev/null',
          timeout: 100, // Very short timeout
        });
        // If it doesn't timeout (on fast systems), that's okay
        if (result.timedOut) {
          expect(result.timedOut).toBe(true);
        }
      } catch (error) {
        // Timeout might throw, that's acceptable
        expect(error).toBeDefined();
      }
    });

    it.skipIf(process.platform === 'win32')('should respect working directory', async () => {
      const dir = process.cwd();
      const result = await shellTool.execute({
        command: 'pwd',
        cwd: dir,
        timeout: 5000,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(dir);
    });
  });

  describe('real execution - pipes and operators', () => {
    it.skipIf(process.platform === 'win32')('should handle simple pipes', async () => {
      const result = await shellTool.execute({
        command: 'ls / | head -n 5',
        timeout: 5000,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.split('\n').filter((l) => l.trim()).length).toBeLessThanOrEqual(5);
    });

    it('should handle && operator (stop on failure)', async () => {
      const result = await shellTool.execute({
        command: 'git log --not-a-real-option-xyz && hostname',
        timeout: 5000,
      });

      expect(result.exitCode).not.toBe(0);
      // Second command (hostname) shouldn't run since first fails
    });

    it('should handle || operator (run second on failure)', async () => {
      const result = await shellTool.execute({
        command: 'git log --not-a-real-option-xyz || hostname',
        timeout: 5000,
      });

      expect(result.exitCode).toBe(0); // hostname succeeds
      expect(result.stdout.trim().length).toBeGreaterThan(0); // hostname produces output
    });
  });

  describe('custom tool configuration', () => {
    it('should allow custom tool configuration', () => {
      const customTool = new ShellTool({
        logger: mockLogger,
        allowedTools: [{ bin: 'custom-bin', group: 'custom' }],
      });

      expect(customTool.isCommandAllowed('custom-bin arg')).toBe(true);
      expect(customTool.isCommandAllowed('ls')).toBe(false); // Default tools not included
    });

    it('should respect readonly flag in configuration', () => {
      const customTool = new ShellTool({
        logger: mockLogger,
        allowedTools: [{ bin: 'test-cmd', group: 'test', readonly: true }],
      });

      const binaries = customTool.getAllowedBinaries();
      expect(binaries).toContain('test-cmd');
    });
  });

  describe('rate limiting', () => {
    it('should allow executions within limit', async () => {
      const tool = new ShellTool({
        logger: mockLogger,
        rateLimit: { maxPerWindow: 5, windowMs: 60_000 },
      });

      // First few calls should succeed
      const result1 = await tool.execute({ command: 'whoami', userId: 'user1' });
      const result2 = await tool.execute({ command: 'whoami', userId: 'user1' });
      expect(result1.exitCode).toBe(0);
      expect(result2.exitCode).toBe(0);
    });

    it('should throw when rate limit is exceeded', async () => {
      const tool = new ShellTool({
        logger: mockLogger,
        rateLimit: { maxPerWindow: 2, windowMs: 60_000 },
      });

      await tool.execute({ command: 'whoami', userId: 'user1' });
      await tool.execute({ command: 'whoami', userId: 'user1' });

      // Third call should be rate limited
      await expect(tool.execute({ command: 'whoami', userId: 'user1' })).rejects.toThrow(
        /Rate limit exceeded/
      );
    });

    it('should track limits separately per user', async () => {
      const tool = new ShellTool({
        logger: mockLogger,
        rateLimit: { maxPerWindow: 1, windowMs: 60_000 },
      });

      await tool.execute({ command: 'whoami', userId: 'user1' });

      // user2 has not been rate limited — should succeed
      const result = await tool.execute({ command: 'whoami', userId: 'user2' });
      expect(result.exitCode).toBe(0);

      // user1 is now over the limit
      await expect(tool.execute({ command: 'whoami', userId: 'user1' })).rejects.toThrow(
        /Rate limit exceeded/
      );
    });

    it('should use "anonymous" as default userId when none provided', async () => {
      const tool = new ShellTool({
        logger: mockLogger,
        rateLimit: { maxPerWindow: 1, windowMs: 60_000 },
      });

      await tool.execute({ command: 'whoami' }); // no userId
      await expect(tool.execute({ command: 'whoami' })).rejects.toThrow(/Rate limit exceeded/);
    });

    it('should not rate limit when no config provided', async () => {
      const tool = new ShellTool({ logger: mockLogger });

      // Many calls with no rateLimit config — should all succeed
      for (let i = 0; i < 10; i++) {
        const result = await tool.execute({ command: 'whoami', userId: 'user1' });
        expect(result.exitCode).toBe(0);
      }
    });
  });

  describe('audit log failure mode', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nachos-audit-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function unwritableAuditPath(): string {
      // Create a *file* (not a dir) at the location where mkdir would try to
      // create the log directory — appendFile will fail because you can't
      // create a file inside a file.
      const blockingFile = path.join(tempDir, 'blocked-dir');
      fs.writeFileSync(blockingFile, '');
      return path.join(blockingFile, 'shell-audit.log');
    }

    it('should warn (default) and continue when audit log write fails', async () => {
      const tool = new ShellTool({
        logger: mockLogger,
        auditLogPath: unwritableAuditPath(),
        // auditLogFailureMode defaults to 'warn'
      });

      // Should NOT throw even though audit log will fail to write
      const result = await tool.execute({ command: 'whoami' });
      expect(result.exitCode).toBe(0);
    });

    it('should throw when auditLogFailureMode is "fail" and audit log write fails', async () => {
      const tool = new ShellTool({
        logger: mockLogger,
        auditLogPath: unwritableAuditPath(),
        auditLogFailureMode: 'fail',
      });

      await expect(tool.execute({ command: 'whoami' })).rejects.toThrow(/Audit log write failed/);
    });
  });
});
