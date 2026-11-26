import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../godot/authority.gd', import.meta.url));

export class AuthorityProcess extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
  }

  async open() {
    const token = randomBytes(32).toString('hex');
    this.listener = createServer();
    this.listener.listen(0, '127.0.0.1');
    await once(this.listener, 'listening');

    try {
      const ready = new Promise((resolve, reject) => {
        this.listener.on('connection', socket => {
          if (this.socket) return socket.destroy();
          this.socket = socket;
          socket.setNoDelay(true);
          socket.setEncoding('utf8');
          socket.on('error', error => this.fail(error));
          socket.on('close', () => this.fail(new Error('Godot authority disconnected')));
          let pending = '';
          socket.on('data', chunk => {
            try {
              pending += chunk;
              while (!this.closed) {
                const newline = pending.indexOf('\n');
                if (newline < 0) break;
                if (newline > 262144) throw new Error('Godot authority frame exceeds limit');
                const message = JSON.parse(pending.slice(0, newline));
                pending = pending.slice(newline + 1);
                if (!this.metadata) {
                  if (message?.type !== 'ready' || message.token !== token || typeof message.mapId !== 'string') {
                    throw new Error('Invalid Godot authority handshake');
                  }
                  this.metadata = { mapId: message.mapId, bases: message.bases };
                  this.listener.close();
                  resolve(this.metadata);
                } else {
                  this.emit(message.type === 'started' ? 'started' : 'frame', message);
                }
              }
              if (pending.length > 262144) throw new Error('Godot authority frame exceeds limit');
            } catch (error) {
              this.fail(error);
            }
          });
        });
        this.once('failure', reject);
      });
      const { godot, project, map, controller, pack, dedicatedPublicMap } = this.config;
      const launcher=dedicatedPublicMap
        ? ['--headless','--main-pack',pack,'--script','res://authority_smoke/authority.gd']
        : ['--headless','--path',project,'--script',entry];
      this.child = spawn(godot, [
        ...launcher, '--',
        '--authority-port', String(this.listener.address().port), '--authority-token', token,
        '--map', map, '--controller', controller
      ], { stdio: ['ignore', 'inherit', 'inherit'], env: this.childEnvironment() });
      this.child.once('error', error => this.fail(error));
      this.child.once('exit', code => this.fail(new Error('Godot authority exited (' + code + ')')));

      const timer = setTimeout(() => this.fail(new Error('Godot authority startup timed out')), 20000);
      try {
        return await ready;
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      this.close();
      throw error;
    }
  }

  childEnvironment() {
    if(this.config.dedicatedPublicMap) return {
      LANG:'C.UTF-8',TZ:'UTC',XDG_DATA_HOME:this.config.runtimeData,
      FOX_AUTHORITY_MODE:'public-preview-v1',FOX_AUTHORITY_EXPECT_MAP:this.config.dedicatedPublicMap
    };
    const child = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      !name.startsWith('FOX_TEACHER_') && name !== 'FOX_COOKIE_SECRET' &&
      !name.startsWith('FOX_FIXTURE_TLS_') && !name.startsWith('FOX_PREVIEW_')));
    if (this.config.loopbackTLSFixture && process.env.FOX_PROTECTED_PREVIEW === 'isolated-loopback-fixture' &&
        process.env.FOX_BIND === '127.0.0.1' && !process.env.FOX_LOCAL_HTTP) {
      // The child accepts only its own existing loopback IPC. This does not enable a hosted adapter.
      child.FOX_LOCAL_HTTP = '1';
      child.FOX_ALLOW_LINUX_AUTHORITY_SMOKE = '1';
    }
    return child;
  }

  async start(room, round, seats) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 6000);
    const onFailure = () => abort.abort();
    this.once('failure', onFailure);
    try {
      const acknowledged = once(this, 'started', { signal: abort.signal });
      try {
        this.send({ type: 'start', room, round, seats });
      } catch (error) {
        abort.abort();
        await acknowledged.catch(() => {});
        throw error;
      }
      const [frame] = await acknowledged;
      if (frame.room !== room || frame.round !== round) throw new Error('Godot acknowledged a different round');
    } finally {
      this.off('failure', onFailure);
      clearTimeout(timer);
    }
  }

  send(message) {
    if (this.closed || !this.socket || this.socket.destroyed) throw new Error('Godot authority unavailable');
    if (this.socket.writableLength > 262144) {
      this.fail(new Error('Godot authority input stalled'));
      throw new Error('Godot authority input stalled');
    }
    this.socket.write(JSON.stringify(message) + '\n');
  }

  fail(error) {
    if (this.closed) return;
    this.close();
    this.emit('failure', error);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.socket?.destroy();
    if (this.listener?.listening) this.listener.close();
    this.child?.kill();
  }
}
