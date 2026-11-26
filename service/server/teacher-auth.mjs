import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';

function equal(left, right) {
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(left), digest(right));
}

export class TeacherAuth {
  constructor(env = process.env) {
    this.username = env.FOX_TEACHER_USERNAME;
    this.password = env.FOX_TEACHER_PASSWORD;
    this.secret = env.FOX_COOKIE_SECRET;
    if (this.password && (this.password.length < 32 || this.password.length > 1024)) {
      throw new Error('Teacher password must contain 32–1024 characters');
    }
    if (this.secret && this.secret.length < 32) throw new Error('Cookie secret requires at least 32 characters');
    this.attemptWindow = 0;
    this.attempts = 0;
    this.instance = randomBytes(32);
    this.revoked = new Map();
    this.secure = env.FOX_LOCAL_HTTP !== '1';
  }

  sign(payload) {
    return createHmac('sha256', this.secret).update(this.instance).update(payload).digest('base64url');
  }

  login(username, password) {
    if (!this.username || !this.password || !this.secret) {
      throw Object.assign(new Error('Teacher sign-in is disabled'), {status: 503});
    }
    if (Date.now() - this.attemptWindow >= 60000) {
      this.attemptWindow = Date.now();
      this.attempts = 0;
    }
    if (typeof username !== 'string' || typeof password !== 'string' ||
        !equal(username, this.username) || !equal(password, this.password)) {
      if (++this.attempts > 10) throw Object.assign(new Error('Too many sign-in attempts'), {status: 429});
      throw Object.assign(new Error('Invalid teacher credentials'), {status: 401});
    }
    const payload = Buffer.from(JSON.stringify([this.username, Date.now() + 6 * 3600000, randomBytes(16).toString('hex')])).toString('base64url');
    return 'fox_teacher=' + payload + '.' + this.sign(payload) +
      '; Path=/; HttpOnly; SameSite=Strict; Max-Age=21600' + (this.secure ? '; Secure' : '');
  }

  session(cookieHeader = '') {
    if (!this.secret || !this.username || !this.password) return null;
    const match = /(?:^|;\s*)fox_teacher=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)(?:;|$)/.exec(cookieHeader);
    if (!match || !equal(this.sign(match[1]), match[2])) return null;
    try {
      const [username, expires, nonce] = JSON.parse(Buffer.from(match[1], 'base64url').toString());
      if (username !== this.username || expires <= Date.now() || !/^[a-f0-9]{32}$/.test(nonce) || this.revoked.has(nonce)) return null;
      return {username, expires, nonce};
    } catch {
      return null;
    }
  }

  identify(cookieHeader) {
    return this.session(cookieHeader)?.username ?? null;
  }

  logout(cookieHeader) {
    const now = Date.now();
    for (const [nonce, expiry] of this.revoked) {
      if (expiry <= now) this.revoked.delete(nonce);
    }
    const session = this.session(cookieHeader);
    if (session) this.revoked.set(session.nonce, session.expires);
    return 'fox_teacher=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' + (this.secure ? '; Secure' : '');
  }
}
