import { Router } from 'express';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { matchIdParamSchema } from '../validation/matches.js';
import {
  createCommentarySchema,
  listCommentaryQuerySchema,
} from '../validation/commentary.js';
import { commentary, matches } from '../db/schema.js';
import { db } from '../db/db.js';

export const commentaryRouter = Router({ mergeParams: true });

const MAX_LIMIT = 100;

/**
 * List commentary events for a match, newest first.
 * @param {import('express').Request} req - Express request with match id param and optional limit query.
 * @param {import('express').Response} res - Express response.
 */
export async function listCommentary(req, res) {
  const params = matchIdParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({
      error: 'Invalid match id.',
      details: z.treeifyError(params.error),
    });
  }

  const query = listCommentaryQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({
      error: 'Invalid query.',
      details: z.treeifyError(query.error),
    });
  }

  const limit = Math.min(query.data.limit ?? 100, MAX_LIMIT);

  try {
    const data = await db
      .select()
      .from(commentary)
      .where(eq(commentary.matchId, params.data.id))
      .orderBy(desc(commentary.createdAt))
      .limit(limit);

    res.json({ data });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: 'Failed to list commentary.',
    });
  }
}

/**
 * Create a commentary event for a match.
 * @param {import('express').Request} req - Express request with match id param and commentary body.
 * @param {import('express').Response} res - Express response.
 */
export async function createCommentary(req, res) {
  const params = matchIdParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({
      error: 'Invalid match id.',
      details: z.treeifyError(params.error),
    });
  }

  const body = createCommentarySchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({
      error: 'Invalid payload.',
      details: z.treeifyError(body.error),
    });
  }

  try {
    const [match] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, params.data.id))
      .limit(1);

    if (!match) {
      return res.status(404).json({
        error: 'Match not found.',
      });
    }

    const [event] = await db
      .insert(commentary)
      .values({
        ...body.data,
        matchId: params.data.id,
      })
      .returning();

    if (res.app.locals.broadcastCommentary) {
      res.app.locals.broadcastCommentary(event.matchId, event);
    }

    res.status(201).json({ data: event });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: 'Failed to create commentary.',
    });
  }
}

commentaryRouter.get('/', listCommentary);
commentaryRouter.post('/', createCommentary);
