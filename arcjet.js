import arcjet, { detectBot, shield, slidingWindow } from '@arcjet/node';
import { isMissingUserAgent } from '@arcjet/inspect';

const arcjetKey = process.env.ARCJET_KEY;
const arcjetMode = process.env.ARCJET_MODE === 'DRY_RUN' ? 'DRY_RUN' : 'LIVE';

if (!arcjetKey) throw new Error('ARCJET_KEY environment variable is missing');

export const httpArcjet = arcjetKey
  ? arcjet({
      key: arcjetKey,
      rules: [
        shield({ mode: arcjetMode }),
        detectBot({
          mode: arcjetMode,
          allow: [
            'CATEGORY:SEARCH_ENGINE',
            'CATEGORY:PREVIEW',
            'CATEGORY:TOOL',
            'CATEGORY:PROGRAMMATIC',
            'CURL',
          ],
        }),
        slidingWindow({ mode: arcjetMode, interval: '10s', max: 50 }),
      ],
    })
  : null;

export const wsArcjet = arcjetKey
  ? arcjet({
      key: arcjetKey,
      rules: [
        shield({ mode: arcjetMode }),
        detectBot({
          mode: arcjetMode,
          allow: [
            'CATEGORY:SEARCH_ENGINE',
            'CATEGORY:PREVIEW',
            'CATEGORY:TOOL',
            'CATEGORY:PROGRAMMATIC',
            'CURL',
          ],
        }),
        slidingWindow({ mode: arcjetMode, interval: '2s', max: 5 }),
      ],
    })
  : null;

/**
 * Whether an Arcjet decision failed due to a missing User-Agent header.
 * @param {{ results: Array<{ reason: unknown }> }} decision - Protect decision.
 * @returns {boolean}
 */
export function hasMissingUserAgent(decision) {
  return decision.results.some(isMissingUserAgent);
}

/**
 * Whether an Arcjet decision reports an unexpected rule error.
 * @param {{ isErrored: () => boolean, results: Array<{ reason: { isError: () => boolean } }> }} decision - Protect decision.
 * @returns {boolean}
 */
export function isArcjetErrored(decision) {
  return (
    decision.isErrored() ||
    decision.results.some((result) => result.reason.isError())
  );
}

export function securityMiddleware() {
  return async (req, res, next) => {
    if (!httpArcjet) return next();

    try {
      const decision = await httpArcjet.protect(req);

      if (hasMissingUserAgent(decision)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (isArcjetErrored(decision)) {
        return res.status(503).json({ error: 'Service Unavailable' });
      }

      if (decision.isDenied()) {
        if (decision.reason.isRateLimit()) {
          return res.status(429).json({ error: 'Too many requests' });
        }

        return res.status(403).json({ error: 'Forbidden' });
      }

      next();
    } catch (error) {
      console.error('Arcjet middleware error:', error);
      return res.status(503).json({ error: 'Service Unavailable' });
    }
  };
}
