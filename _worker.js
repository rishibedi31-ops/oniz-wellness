/**
 * Cloudflare Pages advanced mode.
 * Put this file at the ROOT of the Pages upload together with the website
 * files, and copy ../worker.js next to it (same folder).
 *
 * /api/*  → clinic API (Supabase)
 * everything else → the static site
 */
import { handleRequest } from "./worker.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return handleRequest(request, env);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};
