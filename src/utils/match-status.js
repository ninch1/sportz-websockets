import { MATCH_STATUS } from '../constants/matches.js';

/**
 * Derive a match status from its start and end times relative to now.
 * @param {string|Date} startTime - When the match starts.
 * @param {string|Date} endTime - When the match ends.
 * @param {Date} [now=new Date()] - Reference time used for comparison.
 * @returns {string|null} One of scheduled, live, finished, or null if times are invalid.
 */
export function getMatchStatus(startTime, endTime, now = new Date()) {
  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  if (now < start) {
    return MATCH_STATUS.SCHEDULED;
  }

  if (now >= end) {
    return MATCH_STATUS.FINISHED;
  }

  return MATCH_STATUS.LIVE;
}

/**
 * Persist a recalculated match status when it has changed.
 * @param {{ startTime: string|Date, endTime: string|Date, status: string }} match - Match to sync.
 * @param {(status: string) => Promise<void>} updateStatus - Callback that writes the new status.
 * @returns {Promise<string>} The current (possibly updated) status.
 */
export async function syncMatchStatus(match, updateStatus) {
  const nextStatus = getMatchStatus(match.startTime, match.endTime);
  if (!nextStatus) {
    return match.status;
  }
  if (match.status !== nextStatus) {
    await updateStatus(nextStatus);
    match.status = nextStatus;
  }
  return match.status;
}
