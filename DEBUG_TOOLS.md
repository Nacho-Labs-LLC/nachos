# Debug & System Utilities

Nachos now includes a comprehensive set of safe debugging and system utilities
that the bot can use to inspect its environment, troubleshoot issues, and help
with system administration tasks.

## Overview

All utilities are **read-only** and **security-hardened**:

- ✅ Allowlist-based (only approved tools can run)
- ✅ Output size limits (100KB default)
- ✅ Timeout enforcement (configurable per tool)
- ✅ No destructive operations (no rm, chmod, etc.)
- ✅ Subcommand filtering (e.g., git: only read operations)
- ✅ Direct process spawning (no shell injection)

## Available Tools

### File Inspection

Read-only file system utilities:

```bash
# List directory contents
ls -lah /app

# View file contents
cat config.json
head -100 logs/app.log
tail -50 logs/error.log

# File information
file document.pdf
stat myfile.txt
wc -l source.ts

# Find files
find . -name "*.ts" -type f
find /app -size +10M
```

**Tools**: `ls`, `cat`, `head`, `tail`, `file`, `stat`, `wc`, `find`

### Text Processing

Process and filter text:

```bash
# Search patterns
grep ERROR logs/app.log
grep -r "TODO" src/

# Text transformation
sed 's/old/new/g' file.txt
awk '{print $1}' data.txt
cut -d',' -f1,3 data.csv

# Sorting and filtering
sort names.txt
uniq -c access.log
tr '[:lower:]' '[:upper:]'

# Compare files
diff file1.txt file2.txt
```

**Tools**: `grep`, `sed`, `awk`, `cut`, `sort`, `uniq`, `tr`, `diff`

### Process Inspection

Monitor processes and resources:

```bash
# List processes
ps aux
ps aux | grep node
pgrep -a node

# Resource monitoring
top -b -n 1
htop --version

# Network connections
netstat -tuln
ss -tuln
lsof -i :3000
```

**Tools**: `ps`, `pgrep`, `top`, `htop`, `netstat`, `ss`, `lsof`

### Network Debugging

Test connectivity and inspect network:

```bash
# DNS lookup
dig example.com
nslookup google.com

# Connectivity test
ping -c 3 google.com

# HTTP requests
curl -s https://api.example.com/health
curl -I https://example.com
wget -O- https://example.com

# Network info
ip addr
ip route
```

**Tools**: `ping`, `curl`, `wget`, `dig`, `nslookup`, `ip` (addr/route/link
only)

### System Information

Inspect system state:

```bash
# System details
uname -a
hostname
whoami
pwd
date
uptime

# Resource usage
free -h
df -h
du -sh /app/*

# Environment
env | grep NODE
```

**Tools**: `uname`, `hostname`, `whoami`, `pwd`, `env`, `date`, `uptime`,
`free`, `df`, `du`

### Data Processing

Parse and manipulate structured data:

```bash
# JSON processing
cat config.json | jq '.database'
curl -s https://api.example.com/data | jq '.results[]'

# YAML processing
yq eval '.services' docker-compose.yml
```

**Tools**: `jq`, `yq`, `json`

### Git Operations (Read-Only)

Inspect Git repositories:

```bash
# Repository status
git status
git branch
git remote -v

# View history
git log --oneline -10
git log --since="1 week ago"

# Inspect changes
git diff
git show HEAD
git show commit-hash

# Configuration
git config --list
```

**Allowed**: `status`, `log`, `diff`, `show`, `branch`, `remote`, `config`,
`rev-parse`, `describe`

**Blocked**: `push`, `commit`, `add`, `rm`, `reset`, `rebase`, `merge`, `pull`,
`fetch`, `clone`

### Docker Inspection (Read-Only)

Inspect Docker containers and images:

```bash
# List containers
docker ps
docker ps -a

# View logs
docker logs container-name
docker logs --tail 100 container-name

# Inspect resources
docker inspect container-name
docker stats --no-stream
docker images

# System info
docker version
docker info
```

**Allowed**: `ps`, `logs`, `inspect`, `images`, `stats`, `version`, `info`

**Blocked**: `rm`, `rmi`, `stop`, `kill`, `run`, `exec`, `build`, `push`, `pull`

### Archive Operations (Read-Only)

Extract and inspect archives:

```bash
# List archive contents
tar -tzf archive.tar.gz
unzip -l archive.zip

# Extract archives
tar -xzf archive.tar.gz
unzip archive.zip
gunzip file.gz
bunzip2 file.bz2
```

**Tools**: `tar`, `unzip`, `gunzip`, `bunzip2`

## Common Debugging Workflows

### 1. Application Not Starting

```bash
# Check if process is running
ps aux | grep node

# Check port availability
netstat -tuln | grep 3000
lsof -i :3000

# Check logs
tail -100 logs/app.log | grep ERROR

# Check disk space
df -h
```

### 2. Performance Issues

```bash
# Resource usage
free -h
top -b -n 1 | head -20

# Find large files
du -sh /* | sort -h | tail -10

# Check process load
ps aux --sort=-%cpu | head -10
ps aux --sort=-%mem | head -10
```

### 3. Configuration Problems

```bash
# View config
cat config/app.json | jq

# Check environment
env | grep NODE_ENV
env | grep DATABASE

# Verify file permissions
ls -la config/
stat config/secrets.json
```

### 4. Network Connectivity

```bash
# Test DNS
dig api.example.com
nslookup database.local

# Test HTTP endpoint
curl -I https://api.example.com
curl -s https://api.example.com/health | jq

# Check open connections
netstat -tuln
ss -s
```

### 5. Git Repository Issues

```bash
# Check repo state
git status
git branch
git log --oneline -5

# View uncommitted changes
git diff

# Check remote
git remote -v
git config --list | grep remote
```

### 6. Docker Container Problems

```bash
# Find container
docker ps | grep myapp

# Check logs
docker logs myapp --tail 50

# Inspect configuration
docker inspect myapp | jq '.[0].Config'

# Resource usage
docker stats --no-stream myapp
```

## Security Model

### What's Allowed

✅ **Read operations**: View files, list directories, inspect processes ✅
**Inspection**: System info, network status, resource usage ✅ **Data
processing**: Parse JSON/YAML, filter text ✅ **Network testing**: Ping, DNS
lookup, HTTP requests ✅ **Git read**: Status, logs, diffs (no modifications) ✅
**Docker read**: Inspect containers, view logs (no lifecycle changes)

### What's Blocked

❌ **File modification**: `rm`, `mv`, `cp`, `chmod`, `chown`, `touch`, `mkdir`
❌ **System changes**: `systemctl`, `service`, `reboot`, `shutdown` ❌ **User
management**: `useradd`, `userdel`, `passwd`, `su`, `sudo` ❌ **Package
management**: `apt`, `yum`, `npm`, `pip` (without permission) ❌ **Git write**:
`commit`, `push`, `reset`, `merge` ❌ **Docker lifecycle**: `run`, `stop`,
`kill`, `rm`, `build` ❌ **Dangerous ops**: `dd`, `mkfs`, `fdisk`, `mount`

### Security Features

1. **Allowlist enforcement**: Only pre-approved binaries can execute
2. **Subcommand filtering**: Tools like git/docker have allowed subcommand lists
3. **Output limits**: 100KB maximum output prevents DoS
4. **Timeout enforcement**: Default 30s, max 5min prevents runaway processes
5. **No shell mode**: Direct process spawning prevents command injection
6. **Environment validation**: Required env vars checked before execution

## Examples

### Troubleshoot Slow Application

```bash
# Check system resources
free -h && df -h

# Find memory-heavy processes
ps aux --sort=-%mem | head -10

# Check for large log files
find /app/logs -type f -size +100M

# View recent errors
tail -200 /app/logs/app.log | grep -i error
```

### Inspect API Configuration

```bash
# View current config
cat /app/config/production.json | jq

# Check environment
env | grep API_

# Test endpoint
curl -s http://localhost:3000/health | jq

# Check listening ports
netstat -tuln | grep LISTEN
```

### Debug Docker Container

```bash
# Find container
docker ps | grep api

# Check recent logs
docker logs api-server --tail 100 | grep ERROR

# Inspect network
docker inspect api-server | jq '.[0].NetworkSettings'

# Check resource limits
docker inspect api-server | jq '.[0].HostConfig.Memory'
```

### Analyze Repository State

```bash
# Current branch and status
git branch && git status

# Recent commits
git log --oneline --graph -10

# Show last commit
git show HEAD --stat

# Check for local changes
git diff --name-only
```

## Tool Groups

Tools are organized into logical groups for policy enforcement:

| Group                | Tools                                                         | Purpose                    |
| -------------------- | ------------------------------------------------------------- | -------------------------- |
| `file-inspection`    | ls, cat, head, tail, file, stat, wc, find                     | Read files and directories |
| `text-processing`    | grep, sed, awk, cut, sort, uniq, tr, diff                     | Process and filter text    |
| `process-inspection` | ps, pgrep, top, htop                                          | Monitor processes          |
| `network-info`       | netstat, ss, lsof, ip                                         | Network state inspection   |
| `network-debug`      | ping, curl, wget, dig, nslookup                               | Network testing            |
| `system-info`        | uname, hostname, whoami, pwd, env, date, uptime, free, df, du | System information         |
| `data-processing`    | jq, yq, json                                                  | Parse structured data      |
| `git`                | git (read-only)                                               | Repository inspection      |
| `docker-inspect`     | docker (read-only)                                            | Container inspection       |
| `archive`            | tar, unzip, gunzip, bunzip2                                   | Archive operations         |

## Configuration

Debug tools are enabled by default. To customize:

### Disable Specific Groups

```toml
[tools.shell]
# Disable network debugging tools
disable_groups = ["network-debug"]
```

### Add Custom Tools

```toml
[[tools.shell.custom]]
bin = "kubectl"
group = "kubernetes"
allowed_subcommands = ["get", "describe", "logs"]
readonly = true
```

### Adjust Limits

```toml
[tools.shell]
max_output_size = 200000  # 200KB
default_timeout = 60000   # 60 seconds
max_timeout = 600000      # 10 minutes
```

## Troubleshooting

**Problem**: "Command not allowed" **Solution**: Check if the binary is in the
allowlist. Some tools may not be installed in your environment.

**Problem**: "Subcommand 'X' not allowed" **Solution**: The tool is allowed but
the specific subcommand is blocked (e.g., `git push`). Use read-only operations.

**Problem**: Output truncated **Solution**: Output exceeded 100KB limit. Filter
results or use head/tail to limit output.

**Problem**: Command timed out **Solution**: Operation took too long. Use more
specific queries or filters to reduce processing time.

## Best Practices

1. **Be specific**: Use filters and limits to reduce output
   - ❌ `cat huge-log.log`
   - ✅ `tail -100 huge-log.log | grep ERROR`

2. **Use pipes**: Chain commands for efficiency
   - ❌ Multiple commands
   - ✅ `ps aux | grep node | head -10`

3. **Check before acting**: Inspect before suggesting changes
   - ✅ `ls -la /app/config` before recommending config edits

4. **Limit find**: Use constraints on find commands
   - ❌ `find /`
   - ✅ `find /app -name "*.log" -mtime -1`

5. **Parse with jq**: Extract specific fields from JSON
   - ❌ `cat huge.json`
   - ✅ `cat config.json | jq '.database.host'`

---

**These tools enable effective debugging while maintaining security through
allowlisting, output limits, and read-only enforcement.**
