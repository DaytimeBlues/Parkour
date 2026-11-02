import { env } from 'cloudflare:workers';
import { handleLeaderboard } from '../../../lib/leaderboard.mjs';
import { handleMultiplayer } from '../../../lib/multiplayer.mjs';
import { getChatGPTUser } from '../../chatgpt-auth';
export const dynamic = 'force-dynamic';
async function dispatch(request: Request) {
  if (new URL(request.url).pathname.startsWith('/api/multiplayer/')) {
    return handleMultiplayer(request, env.DB, { principal: await getChatGPTUser() });
  }
  return handleLeaderboard(request, env.DB);
}
export const GET = dispatch;
export const POST = dispatch;
