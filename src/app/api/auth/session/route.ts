import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  createSignedSessionToken,
  hashPassword,
  verifyPassword,
  verifySignedSessionToken,
} from '@/lib/auth';
import { getDataDir } from '@/lib/db/cloudflare-store';

interface StoredUser {
  id: string;
  email: string;
  name: string;
  workspaceId: string;
  passwordHash: string;
  createdAt: string;
}

const COOKIE_NAME = 'reelgen_session';

function getUsersPath(): string {
  return path.join(getDataDir(), 'users.json');
}

function readUsers(): StoredUser[] {
  const p = getUsersPath();
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as StoredUser[];
  } catch {
    return [];
  }
}

function writeUsers(users: StoredUser[]): void {
  fs.writeFileSync(getUsersPath(), JSON.stringify(users, null, 2), 'utf8');
}

function parseSessionCookie(request: Request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  return verifySignedSessionToken(decodeURIComponent(match[1]));
}

export async function GET(request: Request) {
  const session = parseSessionCookie(request);
  if (!session) {
    return NextResponse.json({ authenticated: false, user: null });
  }
  return NextResponse.json({ authenticated: true, user: session });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const mode = String(body.mode || 'signin');
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const name = String(body.name || 'Studio Creator').trim();

    if (!email || !email.includes('@') || password.length < 8) {
      return NextResponse.json(
        { error: 'Valid email and password (minimum 8 characters) are required.' },
        { status: 400 }
      );
    }

    const users = readUsers();
    let user = users.find((u) => u.email === email);

    if (mode === 'signup') {
      if (user) {
        return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 });
      }
      user = {
        id: crypto.randomUUID(),
        email,
        name,
        workspaceId: `ws_${crypto.randomBytes(6).toString('hex')}`,
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString(),
      };
      users.push(user);
      writeUsers(users);
    } else {
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
      }
    }

    const token = createSignedSessionToken({
      userId: user.id,
      workspaceId: user.workspaceId,
      email: user.email,
    });

    const res = NextResponse.json({
      authenticated: true,
      user: { userId: user.id, workspaceId: user.workspaceId, email: user.email, name: user.name },
    });
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });
    return res;
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Authentication failed' }, { status: 400 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ authenticated: false });
  res.cookies.set(COOKIE_NAME, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
