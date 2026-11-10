#!/usr/bin/env python3
"""Fresh prebuilt deployment + backup/restore on disposable Compose projects.
No live AI/provider requests. Never reads the developer's .env or database.
"""
import hashlib
import json
import os
import re
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import time

root = Path(__file__).resolve().parent.parent
version = sys.argv[1] if len(sys.argv) > 1 else '2.3.3'
context = os.environ.get('PARANOD_TEST_DOCKER_CONTEXT')
if not context:
    raise SystemExit('Set PARANOD_TEST_DOCKER_CONTEXT to a verified test daemon.')
if not all(x.isdigit() for x in version.split('.')) or len(version.split('.')) != 3:
    raise SystemExit('Expected a numeric release version.')
base = ['docker', '--context', context]
work = Path(tempfile.mkdtemp(prefix='paranod-release-test-'))
projects = []
key_names = ['auth-secret', 'temp-file-key', 'secrets-encryption-key', 'cron-secret']

def checked_daemon():
    actual = subprocess.check_output(['docker', 'context', 'show'], text=True).strip()
    if actual != context:
        raise RuntimeError('Docker context changed; refusing to mutate resources.')
    subprocess.run(base + ['info', '--format', '{{.Name}} {{.OSType}}'], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

def compose(project, *args, data=None):
    checked_daemon()
    env = dict(os.environ, DOCKER_CONTEXT=context,
               PARANOD_ENV_FILE=str(work / (project + '.env')))
    # These test variables must not inherit production values from the caller.
    config_keys = set(re.findall(r'\$\{([A-Z][A-Z0-9_]*)', (root / 'compose.release.yml').read_text()))
    for key in config_keys | {'COMPOSE_FILE', 'COMPOSE_PROFILES', 'COMPOSE_PROJECT_NAME'}:
        env.pop(key, None)
    cmd = [str(root / 'docker/release.sh'), '-p', project, '--profile', 'agent', *args]
    result = subprocess.run(cmd, cwd=root, env=env, input=data,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        (work / (project + '-error.log')).write_bytes(result.stdout + result.stderr)
        raise RuntimeError('Compose step failed: ' + ' '.join(args[:3]))
    return result.stdout

def new_project():
    project = 'paranod-release-check-' + secrets.token_hex(5)
    assert not subprocess.check_output(base + ['ps', '-aq', '--filter',
        'label=com.docker.compose.project=' + project]).strip()
    env = f'''COMPOSE_PROJECT_NAME={project}
PARANOD_VERSION={version}
APP_BIND_IP=127.0.0.1
APP_PORT=0
APP_URL=http://localhost:3002
BETTER_AUTH_URL=http://localhost:3002
POSTGRES_DB=paranod_release_test
POSTGRES_USER=paranod_release_test
POSTGRES_PASSWORD={secrets.token_hex(32)}
WORKSPACES_RUNNER_TOKEN={secrets.token_hex(32)}
CRON_SECRET=
PARANOD_AGENT_WORKER_ENABLED=true
COMPOSE_PROFILES=agent
'''
    path = work / (project + '.env')
    path.write_text(env)
    path.chmod(0o600)
    projects.append(project)
    compose(project, 'config', '--quiet')
    return project

def app_node(project, code):
    return compose(project, 'exec', '-T', 'app', 'node', '-e', code)

def ready(project):
    for attempt in range(30):
        out = app_node(project, "const {PrismaClient}=require('@prisma/client'); const p=new PrismaClient(); p.agentWorker.count({where:{expiresAt:{gt:new Date()}}}).then(n=>console.log(n)).finally(()=>p.$disconnect());")
        if int(out.strip()) > 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError('Worker heartbeat not ready')
    app_node(project, """const assert=require('node:assert/strict');
(async()=>{for(const path of ['/api/health','/setup','/source.html','/license.txt','/third-party-notices.txt']){
 const r=await fetch('http://traefik'+path,{signal:AbortSignal.timeout(5000)});
 assert.equal(r.status,200);
}
const r=await fetch(process.env.WORKSPACES_RUNNER_URL+'/healthz',{headers:{Authorization:'Bearer '+process.env.WORKSPACES_RUNNER_TOKEN}});
const body=await r.json();assert.equal(body.protocolVersion,2);assert.ok(body.capabilities.cancellableJobs);
})().catch(()=>process.exit(1));""")

def key_hashes(project):
    return json.loads(app_node(project, "const fs=require('fs'),c=require('crypto');console.log(JSON.stringify(Object.fromEntries(" + json.dumps(key_names) + ".map(n=>[n,c.createHash('sha256').update(fs.readFileSync('/var/lib/paranod/'+n)).digest('hex')]))));"))

success = False
try:
    checked_daemon()
    first = new_project()
    compose(first, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '180')
    ready(first)
    before = key_hashes(first)
    app_node(first, """const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{await p.$executeRawUnsafe('CREATE TABLE release_backup_probe (id INTEGER PRIMARY KEY)');await p.$executeRawUnsafe('INSERT INTO release_backup_probe VALUES (22)');require('fs').writeFileSync('/var/lib/paranod/release-file-probe','release-backup-probe');})().finally(()=>p.$disconnect());""")
    print('PASS: fresh prebuilt stack, setup, proxy, worker and runner', flush=True)
    # The documented backup procedure: quiesce writes, dump DB, copy app volume.
    compose(first, 'stop', 'agent-worker', 'app')
    dump = compose(first, 'exec', '-T', 'postgres', 'sh', '-c',
                   'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc')
    app_data = work / 'app-data'
    app_data.mkdir()
    compose(first, 'cp', 'app:/var/lib/paranod/.', str(app_data))
    second = new_project()
    compose(second, 'up', '-d', '--wait', 'postgres')
    compose(second, 'exec', '-T', 'postgres', 'sh', '-c',
            'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --exit-on-error', data=dump)
    compose(second, 'create', '--no-build', 'app')
    compose(second, 'cp', str(app_data) + '/.', 'app:/var/lib/paranod/')
    compose(second, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '180')
    ready(second)
    assert key_hashes(second) == before, 'Persistent keys changed during restore'
    app_node(second, """const assert=require('node:assert/strict'),fs=require('fs');const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{const rows=await p.$queryRawUnsafe('SELECT id FROM release_backup_probe');assert.equal(rows[0].id,22);assert.equal(fs.readFileSync('/var/lib/paranod/release-file-probe','utf8'),'release-backup-probe');})().catch(()=>{process.exitCode=1}).finally(()=>p.$disconnect());""")
    print('PASS: backup restored into a separate stack; DB, files and all persistent keys preserved', flush=True)
    success = True
finally:
    for project in reversed(projects):
        assert project.startswith('paranod-release-check-')
        compose(project, 'down', '-v', '--remove-orphans')
    if success:
        shutil.rmtree(work)
    else:
        print('Diagnostic files retained privately at ' + str(work), file=sys.stderr)
