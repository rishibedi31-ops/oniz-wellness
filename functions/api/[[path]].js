/**
 * Cloudflare Pages Functions catch-all for /api/*
 * Used when the Worker lives in the same Pages project.
 *
 * Folder layout on Pages:
 *   /functions/api/[[path]].js   ← this file
 *   /worker.js                   ← the API
 */
import { handleRequest } from "../../worker.js";

export async function onRequest(context) {
  return handleRequest(context.request, context.env);
}
